# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это

KetoCare — платформа сопровождения кетогенной диетотерапии у детей с лекарственно-резистентной эпилепсией. Врач задаёт назначение (кетосоотношение, калорийность, белковая цель, углеводный лимит), семья его выполняет через веб-кабинет / Telegram-бот / Mini App, врач видит динамику и отчёты. **Ошибка расчёта — клинический риск.**

**Источник истины — `docs/TZ_AI_AGENTS.md`** (ТЗ, 16 разделов, на русском). При конфликте ТЗ ↔ код приоритет у ТЗ; при конфликте ТЗ ↔ `docs/medical/calculation-engine-spec.md` приоритет у медицинской спецификации, расхождение фиксируется в `docs/adr/`.

## Текущее состояние

Идёт **этап 1 «Фундамент»** (раздел 15 ТЗ). Реализовано и покрыто тестами:

- `packages/keto_engine` — verify/solve/scale, 35 provisional-эталонов, property-тесты, покрытие 100%.
- `packages/core` — все 31 таблица раздела 4.2, Alembic-миграции с сидом справочников, репозитории (`access`, `prescriptions`, `products`, `patients`, `users`, `audit`).
- `apps/api` — JWT + TOTP, RBAC-зависимости, `/auth`, `/patients`, `/prescriptions`, `/products`, `/calc`.
- `packages/api-client` — генерируется из OpenAPI (`make openapi`).
- `Makefile`, `infra/docker-compose.dev.yml`, `.github/workflows/ci.yml`.

Не начато (следующее по разделу 15): CSV-импорт продуктов и приглашения (`/auth/invitations`) — остаток этапа 1; далее этап 2 (`packages/ui`, `apps/web`). `apps/bot` и `apps/worker` — только каркас, без логики: они относятся к этапам 3–4, не наполнять их «заодно» (правило 10 ниже).

## Команды

Единая точка входа — Makefile в корне. Использовать именно эти команды, а не вызывать инструменты напрямую:

```
make dev          # docker compose dev: postgres, redis, затем миграции
make test         # pytest + vitest
make test-engine  # только эталонные тесты keto_engine (обязательный отдельный job в CI)
make coverage-engine  # покрытие keto_engine с порогом 100%
make lint         # ruff check + ruff format --check + mypy + prettier --check + tsc --noEmit
make fix          # автоисправление форматирования
make migrate      # alembic upgrade head
make makemigration m="описание"   # alembic revision --autogenerate
make openapi      # выгрузка openapi.json + регенерация packages/api-client
make e2e          # playwright — появляется на этапе 5 ТЗ, сейчас заглушка
```

Один эталонный кейс движка: `uv run pytest packages/keto_engine -k <имя_кейса>`; один тест API: `uv run pytest apps/api -k <имя>`; один vitest: `pnpm --filter <workspace> test -t "<имя>"`.

Интеграционные тесты (`packages/core/tests`, `apps/api/tests`) требуют поднятый postgres: сначала `make dev`. Каждый тест идёт во внешней транзакции с откатом, поэтому БД между тестами чистая. Если порты заняты — `POSTGRES_PORT=5434 REDIS_PORT=6381 make dev` и те же порты в `.env`.

Локальный запуск API: `uv run uvicorn api.main:app --reload --app-dir apps/api/src`, Swagger — `/api/v1/docs`.

`eslint` в `make lint` появится вместе с `apps/web` на этапе 2; сейчас JS-часть проверяется prettier + tsc.

Python-часть — **uv workspace** (`apps/api`, `apps/bot`, `apps/worker`, `packages/keto_engine`, `packages/core`). JS-часть — **pnpm workspaces** (`apps/web`, `apps/miniapp`, `packages/ui`, `packages/api-client`).

## Архитектура

Монорепо, разделённое по границе «расчёт / данные / каналы»:

- **`packages/keto_engine`** — чистое расчётное ядро. Никаких импортов из `core`/`api`, никакого I/O: вход и выход — frozen dataclass'ы. Контракт: `verify(items)`, `solve(ingredients, targets)` (scipy `linprog`/HiGHS, при неразрешимости — `InfeasibleError` с человекочитаемой причиной), `scale(recipe, factor)`, константа `ENGINE_VERSION`. Формула кетосоотношения: `F = R × (P + C)`; в solve равенство линеаризуется как `F − R·P − R·C = 0`. Все медицинские константы — в `keto_engine/constants.py`.
- **`packages/core`** — SQLAlchemy 2.0 (async/asyncpg) модели, pydantic-схемы, репозитории, конфиг, Alembic-миграции. Единственный слой, ходящий в БД.
- **`apps/api`** — FastAPI, префикс `/api/v1`, структура `src/{routers,deps,services}`. В роутерах бизнес-логики нет; БД — только через репозитории `core`; `/calc/*` — тонкие обёртки над keto_engine, ответы включают `engine_version`.
- **`apps/bot`** — aiogram 3, FSM-сценарии дневников. Собственного доступа к БД нет — только вызовы API по сервисному токену `BOT_API_TOKEN`.
- **`apps/worker`** — ARQ + Redis: AI-задачи, PDF-отчёты (jinja2 → weasyprint), напоминания по cron, `notify_family`.
- **`apps/web`** (React 18 + Vite + TanStack Router/Query/Table) и **`apps/miniapp`** (Telegram Mini App) — оба поверх `packages/ui` (Tailwind 4 + shadcn/ui) и `packages/api-client`.
- **`packages/api-client`** — TypeScript-клиент, **генерируется** из OpenAPI (`make openapi`). Ручных `fetch` во фронтенде быть не должно.

Поток данных всегда однонаправленный: канал (web/bot/miniapp) → API → репозитории `core` → БД, а расчёты — API → keto_engine. Бот и Mini App не имеют привилегий помимо API.

## Правила, нарушение которых ломает продукт

Полный список — раздел 0 ТЗ. Наиболее важное:

1. **Медицинские константы не выдумываются.** Их источник — `docs/medical/calculation-engine-spec.md`. Если значения нет — берётся дефолт из ТЗ (раздел 6.2), место помечается `# TODO(med): подтвердить у медицинской команды`, вопрос добавляется в `docs/medical/OPEN_QUESTIONS.md`.
2. **Keto Engine меняется только вместе с тестами.** Падает эталонный тест — правится код, а не тест; менять эталон можно только со ссылкой на новую версию медицинской спецификации. Любое изменение математики → bump `ENGINE_VERSION` (semver). Покрытие ядра — 100%. Эталонные тесты нельзя `skip`/`xfail`.
3. **Схема БД — только через Alembic.** Никаких ручных `ALTER TABLE`, никаких правок миграций, уже попавших в `main`.
4. **Клинические данные не удаляются физически** — только `deleted_at`. `prescriptions` — append-only: изменение назначения = новая строка, UPDATE/DELETE запрещены на уровне репозитория. Физическое удаление — только `python -m core.tools.erase_patient <id>`.
5. **Разграничение доступа проверяется на сервере.** Любая ручка с данными пациента — через зависимость `require_patient_access(patient_id)` (связь через `parent_patient`/`doctor_patient`). Админ к клиническим данным доступа не имеет. Фронтенд-проверки — это UX, не безопасность.
6. **ИИ — человек в контуре.** Ни один результат Claude API не сохраняется как клинические данные без подтверждения человеком: разбор еды подтверждает родитель, сводку — врач (в отчёты попадает только `approved_md`). В промпты не уходят ФИО/контакты/chat_id — всё через единственную функцию `pseudonymize(payload)`. Имена моделей — из env (`AI_MODEL_FAST`, `AI_MODEL_SMART`), не в коде.
7. **Аудит.** `audit_log` обязателен для назначений, правок продуктов/рецептов, операций с учётками, выгрузок данных, привязки/отвязки Telegram.
8. **Язык.** UI-тексты — русский, но всегда через i18n (`apps/web/src/locales/ru/*.json`); захардкоженная строка в JSX — ошибка ревью. Код, идентификаторы, коммиты — английский.
9. **Не выходить за рамки этапа.** Порядок реализации — раздел 15 ТЗ, этапы строго последовательны; функции будущих этапов «заодно» не делаются. Список того, что не реализуется вовсе, — раздел 16.

## Конвенции

- **Python:** ruff (линт + формат), mypy strict в `keto_engine` и `core`, обычный — в apps. Импорты абсолютные. Async везде, где есть I/O.
- **TypeScript:** strict, eslint + prettier, функциональные компоненты PascalCase, хуки `useX`.
- **Коммиты:** Conventional Commits со scope = имя app/package — `feat(api): prescriptions endpoints`. Ветки `feat/<кратко>`, `fix/<кратко>`, PR в `main`, merge только при зелёном CI.
- **ADR:** любое отступление от ТЗ фиксируется в `docs/adr/NNN-название.md` (контекст → решение → последствия) и упоминается в PR.
- **Ошибки API:** `{"error": {"code", "message" (ru), "details"}}`; коды `validation_error`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `infeasible_calculation`, `rate_limited`, `internal`. Пагинация — `?limit=&offset=`, ответ `{"items": [...], "total": n}`.
- **Секреты** — только в `.env` (в `.gitignore`), с фиктивным зеркалом в `.env.example` (полный список переменных — раздел 12 ТЗ).

## Definition of Done

Задача не закрыта, пока (раздел 14 ТЗ): `make lint` зелёный; есть тесты (unit на логику, интеграционный на новый эндпоинт — happy + 403 + валидация, эталоны для engine); миграция применяется на чистую БД и на БД с данными, автогенерация не оставляет диффа; `make openapi` перегенерирован и фронт компилируется; строки через i18n и пишется аудит, если действие из списка; обновлены README/ADR/OPEN_QUESTIONS.
