# Единая точка входа для команд разработки (раздел 2.2 ТЗ).
# Порты postgres/redis можно переопределить: POSTGRES_PORT=5434 REDIS_PORT=6381 make dev

.DEFAULT_GOAL := help
SHELL := /bin/bash

COMPOSE := docker compose -f infra/docker-compose.dev.yml
OPENAPI_JSON := apps/api/openapi.json

.PHONY: help
help: ## Показать список команд
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: dev
dev: ## Поднять окружение (postgres, redis) и применить миграции
	$(COMPOSE) up -d
	@echo "Ожидание готовности postgres..."
	@until $(COMPOSE) exec -T postgres pg_isready -U ketocare >/dev/null 2>&1; do sleep 1; done
	$(MAKE) migrate
	@echo "Готово. API: uv run uvicorn api.main:app --reload --app-dir apps/api/src"

.PHONY: api
api: ## Запустить API локально (uvicorn с автоперезагрузкой)
	@# --no-proxy-headers обязателен: иначе uvicorn сам перепишет адрес клиента из
	@# X-Forwarded-For (по умолчанию доверяя 127.0.0.1), и приложение увидит уже
	@# подменённый адрес — ключ ограничения частоты и audit_log.ip станут
	@# управляемыми клиентом. Доверенные прокси задаются через TRUSTED_PROXY_IPS.
	uv run uvicorn api.main:app --reload --app-dir apps/api/src --no-proxy-headers --port $${API_PORT:-8001}

.PHONY: web
web: ## Запустить веб-кабинет (Vite); /api проксируется на API_PROXY_TARGET
	pnpm --filter @ketocare/web run dev

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
	uv run mypy packages/keto_engine/src/keto_engine packages/core/src/core apps/api/src/api
	@if [ -d node_modules ]; then \
		pnpm -r --if-present run format:check; \
		pnpm -r --if-present run lint; \
		pnpm -r --if-present run typecheck; \
	fi
	@# eslint подключается вместе с apps/web и apps/miniapp на этапе 2 ТЗ

.PHONY: fix
fix: ## Автоисправление форматирования
	uv run ruff check --fix apps packages
	uv run ruff format apps packages
	@if [ -d node_modules ]; then pnpm exec prettier --write . >/dev/null && echo "prettier: ok"; fi

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
