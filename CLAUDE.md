# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это

KetoCare — платформа сопровождения кетогенной диетотерапии у детей с лекарственно-резистентной эпилепсией. Врач задаёт назначение (кетосоотношение, калорийность, белковая цель, углеводный лимит), семья его выполняет через веб-кабинет / Telegram-бот / Mini App, врач видит динамику и отчёты. **Ошибка расчёта — клинический риск.**

**Источник истины — `docs/TZ_AI_AGENTS.md`** (ТЗ, 16 разделов, на русском). При конфликте ТЗ ↔ код приоритет у ТЗ; при конфликте ТЗ ↔ `docs/medical/calculation-engine-spec.md` приоритет у медицинской спецификации, расхождение фиксируется в `docs/adr/`.

## Текущее состояние

**Этап 1 «Фундамент» (раздел 15 ТЗ) завершён.** Реализовано и покрыто тестами:

- `packages/keto_engine` — verify/solve/scale, 35 provisional-эталонов, property-тесты, покрытие 100%.
- `packages/core` — все 31 таблица раздела 4.2, Alembic-миграции с сидом справочников, репозитории (`access`, `prescriptions`, `products`, `patients`, `users`, `audit`).
- `apps/api` — JWT + TOTP, RBAC-зависимости, приглашения, `/auth`, `/patients`, `/prescriptions`, `/products` (включая CSV-импорт), `/calc`. 17 ручек.
- `packages/api-client` — генерируется из OpenAPI (`make openapi`).
- `Makefile`, `infra/docker-compose.dev.yml`, `.github/workflows/ci.yml`.

Идёт **этап 2 «Веб-кабинеты»**:

- `packages/ui` — токены (раздел 8.2, включая тёмную тему для Mini App), `RatioBadge`, `MacroBar`, `WarningBanner`, `DiaryEntryCard`, `DataTable`, `TrendChart`.
- `apps/web` — Tailwind 4, TanStack Router (типизированный `/app/$section` с guard'ами по роли), TanStack Query, react-hook-form + zod, i18n, сессия (access-токен в памяти, refresh в httpOnly cookie), вход с 2FA включая первичную настройку с QR.
- Экраны раздела 8.3: **калькулятор**, **продукты**, **главная родителя**, **меню**, **дневники** (6 видов), **рецепты**, **кабинет врача** (список пациентов с флагами + карта из 5 вкладок), **админка** (учётные записи, база продуктов с CSV-импортом, справочники, журнал аудита).
- `apps/api` — добавлены `/logs`, `/menus`, `/overview`, `/recipes`, `/custom-dishes`, `/clinical`, `/admin`, `/dictionaries`.

Тестов: 677 (483 pytest + 194 vitest), `make test` и `make lint` покрывают оба стека.
`make seed-demo` наполняет локальную БД демо-данными (три роли, продукты, две недели дневника).

**Следующее по разделу 15** — п. 14: `/reports` и задача воркера `render_report` (PDF + CSV). Затем этап 3 (Telegram) и этап 4 (AI). `apps/bot` и `apps/worker` — только каркас, без логики: не наполнять их «заодно» (правило 10 ниже).

## Команды

Единая точка входа — Makefile в корне. Использовать именно эти команды, а не вызывать инструменты напрямую:

```
make dev          # docker compose dev: postgres, redis, затем миграции
make test         # pytest + vitest
make test-engine  # только эталонные тесты keto_engine (обязательный отдельный job в CI)
make coverage-engine  # покрытие keto_engine с порогом 100%
make lint         # ruff check + ruff format --check + mypy + prettier --check + eslint + tsc --noEmit
make fix          # автоисправление форматирования
make migrate      # alembic upgrade head
make makemigration m="описание"   # alembic revision --autogenerate
make openapi      # выгрузка openapi.json + регенерация packages/api-client
make e2e          # playwright — появляется на этапе 5 ТЗ, сейчас заглушка
```

Один эталонный кейс движка: `uv run pytest packages/keto_engine -k <имя_кейса>`; один тест API: `uv run pytest apps/api -k <имя>`; один vitest: `pnpm --filter <workspace> test -t "<имя>"`.

Интеграционные тесты (`packages/core/tests`, `apps/api/tests`) требуют поднятый postgres: сначала `make dev`. Каждый тест идёт во внешней транзакции с откатом, поэтому БД между тестами чистая. Если порты заняты — `POSTGRES_PORT=5434 REDIS_PORT=6381 make dev` и те же порты в `.env`.

Локальный запуск API: `make api` (именно так — цель передаёт `--no-proxy-headers`, иначе uvicorn подменит адрес клиента из `X-Forwarded-For` и ключ лимита с `audit_log.ip` станут управляемыми клиентом; см. `infra/nginx/README.md`). Swagger — `/api/v1/docs`.

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

## Защитные хуки

`.claude/hooks/` блокируют правки, которые нарушают правила выше, — и через
Edit/Write, и через shell. Правила и причины — в `guard_command.py` (единый
источник для обоих режимов), тесты — `.claude/hooks/tests/`, гоняются вместе со
всеми (`make test`).

Заблокировано:

| Путь | Почему |
|---|---|
| `docs/medical/*` | спецификации и эталоны меняет медицинская команда (правило 1, 2) |
| `*/migrations/versions/*.py`, уже в git | закоммиченная миграция не правится (правило 3) |
| `.env` и `.env.*` | секреты редактирует человек (правило 7) |
| `.claude/hooks/`, `.claude/settings.json` | защита, которую агент отключает сам, — не защита |

Разрешено всегда: `docs/medical/OPEN_QUESTIONS.md` (туда пишутся вопросы медкоманде)
и `.env.example` (объявление переменных).

Проверка Bash идёт по принципу **«запрещено, пока не доказано чтение»**: `python3 -c`,
`node -e`, `perl -pi`, `cd` в защищённый каталог считаются пишущими. Чтение
(`cat`, `grep`, `ls`, `head`, `find`, `git log/diff/show`) проходит свободно.
Хук защищает от неосторожности, а не от намеренного обхода.

`engine-guard.sh` (PostToolUse) после каждой правки `packages/keto_engine/src`
прогоняет тесты ядра и требует поднять `ENGINE_VERSION` — правило 2 проверяется
сразу, а не в CI через десяток правок.

Хуки читаются при старте сессии: изменения в `.claude/settings.json` вступают в
силу только в новой сессии.

## Конвенции

- **Python:** ruff (линт + формат), mypy strict в `keto_engine` и `core`, обычный — в apps. Импорты абсолютные. Async везде, где есть I/O.
- **TypeScript:** strict, eslint + prettier, функциональные компоненты PascalCase, хуки `useX`.
- **Коммиты:** Conventional Commits со scope = имя app/package — `feat(api): prescriptions endpoints`. Ветки `feat/<кратко>`, `fix/<кратко>`, PR в `main`, merge только при зелёном CI.
- **ADR:** любое отступление от ТЗ фиксируется в `docs/adr/NNN-название.md` (контекст → решение → последствия) и упоминается в PR.
- **Ошибки API:** `{"error": {"code", "message" (ru), "details"}}`; коды `validation_error`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `infeasible_calculation`, `rate_limited`, `internal`. Пагинация — `?limit=&offset=`, ответ `{"items": [...], "total": n}`.
- **Секреты** — только в `.env` (в `.gitignore`), с фиктивным зеркалом в `.env.example` (полный список переменных — раздел 12 ТЗ).

### Общие места `apps/web` — не заводить копий

Экраны писались параллельно, и каждая копия тут уже однажды разошлась с оригиналом.
Прежде чем добавить своё, посмотрите:

- `features/patients/overview.ts` — единственный запрос `/patients/{id}/overview` (главная, меню, карта врача).
- `features/patients/dayVerdict.ts` — **что интерфейс говорит о соответствии дня назначению.** Соотношение — предупреждение, калорийность — набор (обоснование в файле, вопрос 9 в `docs/medical/OPEN_QUESTIONS.md`). Решение принимается здесь и нигде больше.
- `components/Field.tsx` — `Field` / `SelectField` / `TextAreaField` и `FIELD_CONTROL` (оформление поля для поиска и фильтров). Важна не разметка, а связь подписи, поля и ошибки.
- `routes/sections.tsx` — сопоставление раздела с экраном; новый раздел в `SECTIONS_BY_ROLE` без экрана роняет тест.
- `lib/i18n.ts` — список пространств имён выводится из словарей, отдельно его вести не нужно.

## Инструментарий агента (`.claude/`)

- **Хуки** (`.claude/settings.json` + `.claude/hooks/`): `protect-paths.sh` и `protect-bash.sh` блокируют правки `docs/medical/*` (кроме `OPEN_QUESTIONS.md`), уже закоммиченных миграций в `packages/core/migrations/versions/` и `.env` — и через Edit/Write, и через shell. Список защищённых путей — в `lib-protected.sh`, дублировать его в других скриптах не нужно. `autoformat.sh` прогоняет ruff/prettier по изменённому файлу (рукописный markdown в `docs/` не трогает).
- **Скиллы** (`.claude/skills/`): `keto-engine`, `reference-cases`, `db-migrations`, `api-endpoint`, `frontend-feature`, `bot-scenario`, `ai-worker` — процедуры и инварианты по каждой зоне. Подхватываются автоматически по описанию; при расхождении скилла с кодом источник правды — код и ТЗ, скилл правится.
- **Сабагент** `safety-reviewer` — чек-лист клинических и security-инвариантов по дифу; запускать перед закрытием задачи, особенно при изменениях в доступах, `keto_engine`, AI-вызовах и схеме БД.

## Definition of Done

Задача не закрыта, пока (раздел 14 ТЗ): `make lint` зелёный; есть тесты (unit на логику, интеграционный на новый эндпоинт — happy + 403 + валидация, эталоны для engine); миграция применяется на чистую БД и на БД с данными, автогенерация не оставляет диффа; `make openapi` перегенерирован и фронт компилируется; строки через i18n и пишется аудит, если действие из списка; обновлены README/ADR/OPEN_QUESTIONS.
