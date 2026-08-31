# Единая точка входа для команд разработки (раздел 2.2 ТЗ).

.DEFAULT_GOAL := help
SHELL := /bin/bash

COMPOSE := docker compose -f infra/docker-compose.dev.yml
OPENAPI_JSON := apps/api/openapi.json

# Порты контейнеров вычитываются из `.env` — оттуда же, откуда их берёт
# приложение. Раньше они задавались отдельно (`POSTGRES_PORT=5434 make dev`), и
# `make dev` без этой приставки поднимал postgres на 5432, пока приложение
# ходило на 5434: команда отрабатывала успешно, а окружение получалось
# нерабочим. Второе объявление порта всегда однажды расходится с первым.
#
# Переопределить по-прежнему можно из командной строки: значения оттуда
# перекрывают `?=`.
ENV_FILE := .env
# Разделитель у sed — запятая, а не решётка: в Makefile `#` открывает
# комментарий и обрезает строку прямо посреди выражения.
DB_PORT_FROM_ENV := $(shell sed -n 's,^DATABASE_URL=.*@[^:]*:\([0-9][0-9]*\)/.*,\1,p' $(ENV_FILE) 2>/dev/null | tail -1)
REDIS_PORT_FROM_ENV := $(shell sed -n 's,^REDIS_URL=.*:\([0-9][0-9]*\)/.*,\1,p' $(ENV_FILE) 2>/dev/null | tail -1)
# Порт API — из того же `API_PROXY_TARGET`, куда дев-сервер кабинета проксирует
# `/api`. Отдельной переменной у него нет намеренно: это ровно один порт, и два
# его объявления рано или поздно разъедутся — кабинет будет стучаться в 8001,
# пока uvicorn слушает 8002, и «сервер не отвечает» придётся отлаживать с нуля.
API_PORT_FROM_ENV := $(shell sed -n 's,^API_PROXY_TARGET=[a-z]*://[^:]*:\([0-9][0-9]*\).*,\1,p' $(ENV_FILE) 2>/dev/null | tail -1)

export POSTGRES_PORT ?= $(or $(DB_PORT_FROM_ENV),5432)
export REDIS_PORT ?= $(or $(REDIS_PORT_FROM_ENV),6379)
export API_PORT ?= $(or $(API_PORT_FROM_ENV),8001)

.PHONY: help
help: ## Показать список команд
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# Единственный вход для свежего клона. До него сборка расходилась по трём
# граблям, и каждая выглядела как «всё встало», а не как ошибка:
#   • `uv sync` без `--all-packages` ставит только корневые dev-зависимости и
#     молча пропускает воркспейс — приложение потом не импортируется;
#   • pnpm в системе может отсутствовать: в Node он поставляется через corepack,
#     который надо включить;
#   • без `.env` Makefile берёт порты по умолчанию (5432/6379), а они почти
#     всегда заняты соседним проектом.
.PHONY: setup
setup: ## Подготовить свежий клон: зависимости, pnpm, .env
	uv sync --all-packages
	@if command -v pnpm >/dev/null 2>&1; then \
		echo "pnpm $$(pnpm --version) — на месте"; \
	elif command -v corepack >/dev/null 2>&1; then \
		echo "pnpm не найден, включаю через corepack..."; \
		corepack enable pnpm || { \
			echo "corepack enable не сработал — поставьте pnpm вручную: https://pnpm.io/installation"; \
			exit 1; }; \
	else \
		echo "Нет ни pnpm, ни corepack. Нужен Node 20+ — corepack входит в поставку."; \
		exit 1; \
	fi
	@# --frozen-lockfile как в CI: иначе `make setup` на свежем клоне может молча
	@# переписать pnpm-lock.yaml, и расхождение всплывёт уже на PR.
	pnpm install --frozen-lockfile
	@# `.env` только создаётся, и только когда его нет: существующий файл не
	@# трогаем — там уже могут быть настоящие токены (правило 7).
	@if [ -f $(ENV_FILE) ]; then \
		echo "$(ENV_FILE) уже есть — оставляю как есть."; \
	else \
		key=$$(uv run python -c 'import secrets; print(secrets.token_urlsafe(48))'); \
		if [ -z "$$key" ]; then \
			echo "Не удалось сгенерировать SECRET_KEY — $(ENV_FILE) не создан."; \
			exit 1; \
		fi; \
		: '  umask — файл под боевые токены не должен быть доступен на чтение'; \
		: '  всей машине. Значение подставляет awk из окружения, а не sed из'; \
		: '  аргумента: аргументы видны в `ps aux` любому пользователю.'; \
		( umask 077; SECRET_KEY_VALUE="$$key" awk \
			'$$0 ~ /^SECRET_KEY=/ { print "SECRET_KEY=" ENVIRON["SECRET_KEY_VALUE"]; next } { print }' \
			.env.example > $(ENV_FILE) ); \
		echo "Создан $(ENV_FILE) из .env.example, SECRET_KEY сгенерирован."; \
		echo "BOT_TOKEN и ANTHROPIC_API_KEY остались фиктивными — впишите свои, когда дойдёт до бота и ИИ."; \
	fi
	@# `packages/api-client/src/generated` не в git — он выводится из OpenAPI.
	@# Без этого шага свежий клон встречает разработчика красными импортами в
	@# редакторе и падающим `pnpm typecheck`, хотя код исправен.
	$(MAKE) openapi
	@echo
	@echo "Дальше: make dev — postgres, redis и миграции. Затем make seed-demo."

.PHONY: check-env
check-env:
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "Нет $(ENV_FILE) — окружение не настроено."; \
		echo "Выполните: make setup"; \
		exit 1; \
	fi

# Порты проверяются до `docker compose up`: иначе единственный признак конфликта —
# «bind: address already in use» посреди лога компоуза, где не видно ни какой
# порт нужен приложению, ни где его менять.
#
# Проба через bash /dev/tcp, а не lsof: lsof не показывает сокеты, открытые
# другим пользователем, и занятый порт выглядел у него свободным.
#
# Свой уже поднятый контейнер занимать порт «не считается» — иначе повторный
# `make dev` ругался бы на самого себя. Но признаком своего служит именно
# опубликованный порт (`compose port`), а не факт запуска сервиса: имя
# compose-проекта (`ketocare-dev`) общее для всех клонов репозитория, поэтому
# второй клон видит контейнеры первого как свои. С проверкой «сервис запущен»
# он пропускал занятый порт и молча пересоздавал чужое окружение.
.PHONY: check-ports
check-ports:
	@free_port() { p=$$1; while (echo >/dev/tcp/127.0.0.1/$$p) 2>/dev/null; do p=$$((p+1)); done; echo $$p; }; \
	busy=""; \
	for spec in "postgres $(POSTGRES_PORT) DATABASE_URL 5432" "redis $(REDIS_PORT) REDIS_URL 6379"; do \
		set -- $$spec; name=$$1; port=$$2; var=$$3; inner=$$4; \
		published=$$($(COMPOSE) port $$name $$inner 2>/dev/null | sed 's,.*:,,'); \
		if [ "$$published" = "$$port" ]; then continue; fi; \
		if (echo >/dev/tcp/127.0.0.1/$$port) 2>/dev/null; then \
			echo "Порт $$port занят — на нём не поднимется $$name."; \
			echo "  Впишите свободный порт в $$var внутри $(ENV_FILE) — например $$(free_port $$((port+1)))."; \
			busy=1; \
		fi; \
	done; \
	if [ -n "$$busy" ]; then \
		echo; \
		echo "Порты контейнеров Makefile берёт из $(ENV_FILE) — там же их и менять."; \
		exit 1; \
	fi

.PHONY: dev
dev: check-env check-ports ## Поднять окружение (postgres, redis) и применить миграции
	@echo "postgres :$(POSTGRES_PORT), redis :$(REDIS_PORT) — из $(ENV_FILE)"
	$(COMPOSE) up -d
	@echo "Ожидание готовности postgres..."
	@until $(COMPOSE) exec -T postgres pg_isready -U ketocare >/dev/null 2>&1; do sleep 1; done
	$(MAKE) migrate
	@echo "Готово. API: uv run uvicorn api.main:app --reload --app-dir apps/api/src"

.PHONY: api
api: check-env ## Запустить API локально (uvicorn с автоперезагрузкой)
	@# --no-proxy-headers обязателен: иначе uvicorn сам перепишет адрес клиента из
	@# X-Forwarded-For (по умолчанию доверяя 127.0.0.1), и приложение увидит уже
	@# подменённый адрес — ключ ограничения частоты и audit_log.ip станут
	@# управляемыми клиентом. Доверенные прокси задаются через TRUSTED_PROXY_IPS.
	uv run uvicorn api.main:app --reload --app-dir apps/api/src --no-proxy-headers --port $(API_PORT)

.PHONY: web
web: check-env ## Запустить веб-кабинет (Vite); /api проксируется на API_PROXY_TARGET
	@# Порт берёт сам vite из WEB_PORT в корневом `.env` (loadEnv + envDir).
	@# По умолчанию 5173; если он занят другим проектом, поправьте в корневом
	@# `.env` строку WEB_PORT — и кабинет поднимется там же.
	pnpm --filter @ketocare/web run dev

.PHONY: landing
landing: check-env ## Запустить посадочную страницу (astro dev); /api проксируется на API_PROXY_TARGET
	@# Порт — LANDING_PORT в корневом файле настроек, читает его сам astro.
	@# Прокси `/api` обязателен: на сервере его делает nginx, и без него форма
	@# заявки локально отвечает 404 — единственную публичную ручку записи
	@# нельзя было проверить, не собрав лендинг и не подняв рядом nginx.
	pnpm --filter @ketocare/landing run dev

.PHONY: down
down: ## Остановить окружение
	$(COMPOSE) down

.PHONY: test
test: openapi ## Все тесты (pytest + vitest; сначала генерирует api-client)
	uv run pytest
	@if [ -d node_modules ]; then pnpm -r --if-present run test; else \
		echo "node_modules нет — vitest пропущен (запустите pnpm install)"; fi

.PHONY: test-engine
test-engine: ## Только эталонные тесты keto_engine
	uv run pytest packages/keto_engine -v

.PHONY: lint
lint: openapi ## Линтеры и проверка типов (сначала генерирует api-client)
	uv run ruff check apps packages
	uv run ruff format --check apps packages
	uv run mypy packages/keto_engine/src/keto_engine packages/core/src/core apps/api/src/api apps/bot/src/bot apps/worker/src/worker
	@# Шаги соединены через `&&`, а не `;`: при `;` код выхода блока — это код
	@# последней команды, и падение prettier или eslint терялось. `make lint`
	@# возвращал 0 при непройденной проверке форматирования, и её ловил уже CI.
	@if [ -d node_modules ]; then \
		pnpm -r --if-present run format:check \
		&& pnpm -r --if-present run lint \
		&& pnpm -r --if-present run typecheck; \
	fi

.PHONY: fix
fix: ## Автоисправление форматирования
	uv run ruff check --fix apps packages
	uv run ruff format apps packages
	@# Через скрипты пакетов (`format`), а не `exec prettier --write src`:
	@# пути должен знать сам пакет. С зашитым `src` лендинг форматировался не
	@# целиком — его `format:check` смотрит ещё и `scripts/`, и файл оттуда
	@# ронял `make lint`, а `make fix` его не чинил.
	@#
	@# `exec` не понимает `--if-present` (это опция `run`) — с ней команда
	@# падала с «Unknown option», а `&& echo` просто не выполнялся, и `make fix`
	@# молча переставал форматировать JS. Отсюда проверка кода выхода: тихо не
	@# форматировать хуже, чем не форматировать заметно.
	@if [ -d node_modules ]; then \
		pnpm -r --if-present run format >/dev/null \
		&& echo "prettier: ok" \
		&& pnpm -r exec eslint src --fix >/dev/null \
		&& echo "eslint: ok"; \
	fi

.PHONY: bot
bot: check-env ## Запустить Telegram-бота (aiogram, long polling)
	@# `python -m bot.main`, а не консольный скрипт: точка входа у бота одна и
	@# лежит в модуле. Нужны поднятые redis (состояния FSM и секреты привязок) и
	@# API по BOT_API_BASE_URL — то есть сначала `make dev` и `make api`.
	uv run python -m bot.main

.PHONY: worker
worker: ## Запустить ARQ-воркер (PDF-отчёты)
	# `python -m arq`, а не консольный скрипт `arq`: у скрипта в .venv/bin
	# шебанг `#!/bin/sh`, а macOS вычищает переменные DYLD_* при запуске
	# защищённых системой бинарников — и путь к pango с cairo до Python не
	# доезжает. Запуск интерпретатора напрямую переменную сохраняет.
	#
	# DYLD_FALLBACK_LIBRARY_PATH нужен там же: библиотеки стоят в
	# /opt/homebrew/lib, куда dyld при dlopen из Python не смотрит. На Linux
	# переменная игнорируется, в образе библиотеки лежат в системных путях.
	DYLD_FALLBACK_LIBRARY_PATH=$${DYLD_FALLBACK_LIBRARY_PATH:-/opt/homebrew/lib} \
		uv run python -m arq worker.main.WorkerSettingsARQ

.PHONY: seed-demo
seed-demo: ## Наполнить локальную БД демо-данными (учётки, продукты, две недели дневника)
	uv run python infra/scripts/seed_demo.py

.PHONY: migrate
migrate: ## Применить миграции (alembic upgrade head)
	cd packages/core && uv run --project ../.. alembic upgrade head

.PHONY: makemigration
makemigration: ## Создать миграцию: make makemigration m="описание"
	@if [ -z "$(m)" ]; then echo 'Укажите описание: make makemigration m="add x"'; exit 1; fi
	cd packages/core && uv run --project ../.. alembic revision --autogenerate -m "$(m)"

.PHONY: openapi
openapi: ## Выгрузить openapi.json и перегенерировать packages/api-client
	uv run python apps/api/scripts/export_openapi.py $(OPENAPI_JSON)
	@if [ -d node_modules ]; then \
		pnpm --filter @ketocare/api-client run generate; \
	else \
		echo "node_modules нет — пропущена генерация клиента (запустите pnpm install)"; \
	fi

.PHONY: e2e
e2e: ## Playwright-тесты (требует make dev)
	@echo "E2E появляются на этапе 5 ТЗ (раздел 15, п.22)"; exit 1

.PHONY: coverage-engine
coverage-engine: ## Покрытие keto_engine (по ТЗ требуется 100%)
	uv run pytest packages/keto_engine --cov=keto_engine --cov-report=term-missing --cov-fail-under=100
