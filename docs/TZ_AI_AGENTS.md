# KetoCare — Техническое задание для ИИ-агентов (Claude Code)

> **Версия:** 1.0 · **Статус:** рабочий документ разработки
> **Назначение:** единый источник истины для ИИ-агентов, ведущих разработку платформы KetoCare в Claude Code. Документ самодостаточен: агент не должен обращаться к внешним документам, кроме файлов репозитория, на которые здесь есть ссылки.
> **Основание:** коммерческое предложение ООО «RailTech» (KetoCare_KP_RailTech.docx).

---

## 0. Правила работы агента

Эти правила имеют приоритет над любыми другими соображениями в ходе разработки.

1. **Медицинские константы — только из спецификации.** Энергетические коэффициенты, допуски, пороги предупреждений, формулы задаются файлом `docs/medical/calculation-engine-spec.md`. Если значения там нет — агент использует значение по умолчанию из настоящего ТЗ, помечает место комментарием `# TODO(med): подтвердить у медицинской команды` и вносит вопрос в `docs/medical/OPEN_QUESTIONS.md`. Агент **никогда не выдумывает** медицинские правила.
2. **Keto Engine меняется только вместе с тестами.** Любое изменение в `packages/keto_engine/` требует: обновления эталонных тестов, прогона всего набора, повышения версии пакета (semver). Если эталонный тест падает — исправляется код, а не тест; изменение эталона возможно только со ссылкой на новую версию медицинской спецификации.
3. **Схема БД меняется только через Alembic-миграции.** Никаких ручных `ALTER TABLE`, никаких правок старых миграций после их попадания в `main`.
4. **Клинические данные не удаляются физически.** Все дневниковые и клинические записи — только мягкое удаление (`deleted_at`). Назначения (`prescriptions`) — append-only.
5. **Разграничение доступа проверяется на сервере.** Любой эндпоинт, работающий с данными пациента, обязан проверять связь текущего пользователя с этим пациентом. Фронтенд-проверки — только UX, не безопасность.
6. **ИИ-функции — человек-в-контуре.** Ни один результат Claude API не сохраняется как клинические данные без явного подтверждения человеком (родителем — записи, врачом — сводки).
7. **Секреты не попадают в репозиторий.** Только `.env` (в `.gitignore`) + `.env.example` с фиктивными значениями.
8. **Определение готовности (DoD)** — раздел 14. Задача не считается выполненной, пока DoD не выполнен.
9. **Язык:** UI-тексты — русский; код, идентификаторы, коммиты — английский. Все пользовательские строки — через i18n-слой (раздел 8.5), даже пока язык один.
10. **Не выходить за рамки этапа.** Порядок реализации — раздел 15. Функции будущих этапов не реализуются «заодно».

---

## 1. Продукт в двух абзацах

KetoCare — платформа сопровождения кетогенной диетотерапии у детей с лекарственно-резистентной эпилепсией. Врач задаёт назначение (кетогенное соотношение, калорийность, белковую цель, углеводный лимит); семья с помощью платформы точно выполняет его: рассчитывает блюда, ведёт меню и дневники (приступы, кетоны, вес, лекарства, самочувствие); врач видит динамику и отчёты. Ошибка расчёта — клинический риск, поэтому расчётное ядро изолировано и валидируется по эталонам.

Каналы: веб-SPA (кабинеты родителя, врача/диетолога, администратора), Telegram-бот (быстрый ввод и напоминания), Telegram Mini App (кабинет родителя внутри Telegram), AI-модуль (ассистент, разбор свободного текста, сводки для врача).

**Глоссарий:**

| Термин | Значение |
|---|---|
| Кетосоотношение (ratio, R) | Отношение массы жиров к сумме масс белков и углеводов: `F = R × (P + C)` |
| Назначение (prescription) | Набор параметров диеты, заданный врачом; версионируется |
| Keto Engine | Изолированный расчётный пакет `packages/keto_engine` |
| Эталонные расчёты | Тестовые сценарии от медицинской команды; критерий приёмки ядра |
| Mini App (TMA) | Telegram Mini App — веб-приложение внутри Telegram |

---

## 2. Монорепозиторий

### 2.1. Структура

```
ketocare/
├─ CLAUDE.md                  # краткая памятка агенту: команды, ссылки на это ТЗ
├─ docs/
│  ├─ TZ_AI_AGENTS.md         # настоящий документ
│  ├─ medical/
│  │  ├─ calculation-engine-spec.md   # медицинская спецификация (источник констант)
│  │  ├─ reference-cases/             # эталонные расчёты (yaml)
│  │  └─ OPEN_QUESTIONS.md            # вопросы медицинской команде
│  └─ adr/                    # architecture decision records (нумерованные md)
├─ apps/
│  ├─ api/                    # FastAPI
│  ├─ bot/                    # aiogram 3
│  ├─ worker/                 # ARQ-воркер (AI-задачи, PDF, напоминания)
│  ├─ web/                    # React SPA (три кабинета)
│  └─ miniapp/                # Telegram Mini App (React)
├─ packages/
│  ├─ keto_engine/            # Python: расчётное ядро
│  ├─ core/                   # Python: модели SQLAlchemy, схемы, репозитории, конфиг
│  ├─ ui/                     # React: дизайн-система (общая для web и miniapp)
│  └─ api-client/             # TypeScript: клиент, генерируется из OpenAPI
├─ infra/
│  ├─ docker-compose.yml          # прод
│  ├─ docker-compose.dev.yml      # локальная разработка
│  ├─ nginx/
│  └─ scripts/                # backup, restore, deploy
├─ .github/workflows/         # CI
├─ pyproject.toml             # uv workspace (корень)
├─ package.json               # pnpm workspace (корень)
├─ pnpm-workspace.yaml
└─ Makefile                   # единая точка входа для команд
```

### 2.2. Инструменты и команды

Python-часть — **uv workspace** (`apps/api`, `apps/bot`, `apps/worker`, `packages/keto_engine`, `packages/core` — члены workspace). JS-часть — **pnpm workspaces** (`apps/web`, `apps/miniapp`, `packages/ui`, `packages/api-client`).

Все команды — через Makefile; агент использует именно их:

```makefile
make dev          # поднять всё локально (docker compose dev: postgres, redis + hot-reload процессы)
make test         # все тесты: pytest + vitest
make test-engine  # только эталонные тесты keto_engine
make lint         # ruff check + ruff format --check + mypy + eslint + prettier --check + tsc --noEmit
make fix          # автоисправление форматирования
make migrate      # alembic upgrade head
make makemigration m="описание"   # alembic revision --autogenerate
make openapi      # выгрузить openapi.json и перегенерировать packages/api-client
make e2e          # playwright-тесты (требует make dev)
```

### 2.3. Конвенции кода

- **Python:** ruff (линт + формат), mypy strict в `keto_engine` и `core`, обычный — в apps. Импорты абсолютные. Асинхронный код везде, где есть I/O.
- **TypeScript:** strict; eslint + prettier; компоненты — функциональные, PascalCase; хуки `useX`.
- **Коммиты:** Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`), scope = имя app/package: `feat(api): prescriptions endpoints`.
- **Ветки:** `feat/<кратко>`, `fix/<кратко>`; PR в `main`; merge только при зелёном CI.
- **ADR:** каждое отступление от настоящего ТЗ фиксируется в `docs/adr/NNN-название.md` (контекст → решение → последствия) и упоминается в PR.

---

## 3. Стек и версии

| Слой | Технология | Версия (минимум) |
|---|---|---|
| Язык backend | Python | 3.12 |
| API | FastAPI + Pydantic v2 | последние стабильные |
| ORM / миграции | SQLAlchemy 2.0 (async, asyncpg) + Alembic | 2.0.x |
| Бот | aiogram | 3.x |
| Очередь | ARQ + Redis | Redis 7 |
| БД | PostgreSQL | 16 |
| AI | Anthropic Python SDK (Claude API) | последняя |
| Оптимизация | scipy (`linprog`, HiGHS) | 1.x |
| PDF-отчёты | weasyprint (HTML → PDF) | последняя |
| Frontend | React 19 + TypeScript 5 + Vite | компоненты shadcn/ui написаны под React 19: под 18 они молча теряют `ref`, и формы отправляют пустые значения (ADR-0005) |
| UI | Tailwind CSS + shadcn/ui (Radix) | Tailwind 4 |
| Данные на фронте | TanStack Query v5, TanStack Router, TanStack Table v8 | — |
| Формы | react-hook-form + zod | — |
| Графики | Recharts | — |
| Mini App | @telegram-apps/sdk-react | последняя |
| Наблюдаемость | structlog (JSON-логи), Sentry SDK | — |
| E2E | Playwright | — |

Точные версии фиксируются lock-файлами (`uv.lock`, `pnpm-lock.yaml`). Обновление зависимостей — отдельными PR.

---

## 4. База данных (PostgreSQL 16)

### 4.1. Общие правила

- Первичные ключи — `uuid` (генерация `gen_random_uuid()`).
- Везде `created_at timestamptz not null default now()`; на изменяемых таблицах `updated_at`.
- Мягкое удаление: `deleted_at timestamptz null` на всех клинических и дневниковых таблицах; выборки по умолчанию фильтруют `deleted_at is null`.
- Enum-поля — PostgreSQL enum-типы, определённые в `packages/core`.
- Денормализованные расчётные значения (итоги рецепта, меню) хранятся вместе с `engine_version`.

### 4.2. Таблицы

**Учётные записи и связи**

| Таблица | Поля |
|---|---|
| `users` | id, role (`admin` \| `doctor` \| `dietitian` \| `parent`), full_name, email (unique, citext), phone, password_hash (argon2id), totp_secret (nullable, обязателен к настройке для admin/doctor/dietitian), is_active, invited_by (fk users), last_login_at |
| `patients` | id, full_name, birth_date, sex (`m`\|`f`), height_cm numeric(5,1), allergies jsonb (список строк-идентификаторов продуктов и свободных меток), notes |
| `parent_patient` | parent_id fk, patient_id fk, unique(parent_id, patient_id) |
| `doctor_patient` | doctor_id fk, patient_id fk, unique(doctor_id, patient_id) |
| `invitations` | id, email, role, token_hash, expires_at, accepted_at |
| `telegram_accounts` | id, parent_id fk, patient_id fk, chat_id bigint unique, linked_at, revoked_at |
| `link_codes` | code (8 симв., unique), parent_id, patient_id, expires_at (15 мин), used_at |

**Клиника**

| Таблица | Поля |
|---|---|
| `medical_profiles` | patient_id (unique fk), diagnosis text, epilepsy_type text, onset_age_months int, genetics jsonb (`{gene, variant, interpretation}`), comorbidities text |
| `prescriptions` | id, patient_id, ratio numeric(3,1), kcal_per_day int, protein_g numeric(6,1), carbs_limit_g numeric(6,1), meals_per_day int, restrictions text, author_id fk users, effective_from date, created_at. **Append-only:** изменение = новая строка; активное назначение = последняя по created_at. UPDATE/DELETE запрещены на уровне репозитория |
| `medications` | id, patient_id, drug_name, dose, frequency, started_at date, stopped_at date null, author_id |
| `clinical_notes` | id, patient_id, author_id, text, created_at |

**Контент**

| Таблица | Поля |
|---|---|
| `products` | id, name_ru, name_uz null, name_en null, category_id fk, kcal_100g numeric(7,2), fat_100g, protein_100g, carbs_100g, fiber_100g (все numeric(6,2)), source text not null, source_version text not null, verified_at date not null, is_active bool |
| `product_revisions` | id, product_id, snapshot jsonb, changed_by, changed_at — пишется триггером/репозиторием при каждом изменении `products` |
| `product_categories` | id, name_ru, sort |
| `recipes` | id, title, category (`breakfast`\|`lunch`\|`dinner`\|`snack`\|`dessert`\|`drink`), photo_path, yield_g, servings, instructions text, status (`draft`\|`reviewed`\|`published`), computed jsonb (`{kcal, fat, protein, carbs, ratio}`), engine_version, author_id |
| `recipe_ingredients` | recipe_id, product_id, grams numeric(7,1), position |
| `custom_dishes` | id, patient_id, title, ingredients jsonb (`[{product_id, grams}]`), computed jsonb, engine_version |

**Питание и дневники** (у всех: patient_id, occurred_at timestamptz, source (`web`\|`bot`\|`miniapp`\|`ai_parsed`), created_by fk users null, deleted_at)

| Таблица | Специфичные поля |
|---|---|
| `menus` | id, patient_id, date (unique вместе с patient_id), totals jsonb, engine_version |
| `menu_items` | menu_id, meal_slot (`breakfast`…), recipe_id null, custom_dish_id null, portion_factor numeric(4,2), eaten bool default false |
| `seizure_logs` | seizure_type_id fk, duration_sec int null, count int default 1, description, triggers text null |
| `ketone_logs` | value numeric(4,1), method (`blood`\|`urine`) |
| `weight_logs` | weight_kg numeric(5,2), height_cm numeric(5,1) null |
| `medication_logs` | medication_id fk, taken bool |
| `meal_logs` | menu_item_id null, free_text text null, parsed jsonb null (результат AI-разбора) |
| `side_effect_logs` | symptom, description |
| `seizure_types`, `ketone_methods` | справочники: id, name_ru, sort (наполняются миграцией-сидом; правятся админом) |

**ИИ и служебные**

| Таблица | Поля |
|---|---|
| `ai_jobs` | id, kind (`assistant`\|`parse_meal`\|`parse_event`\|`doctor_summary`\|`content_draft`), status (`queued`\|`running`\|`done`\|`failed`), requested_by, patient_id null, input jsonb, output jsonb, model, tokens_in, tokens_out, cost_usd numeric(8,4), error, created_at, finished_at |
| `ai_conversations` | id, user_id, patient_id null, channel (`web`\|`miniapp`), messages jsonb, updated_at |
| `doctor_summaries` | id, patient_id, period_start, period_end, draft_md text, approved_md text null, approved_by null, ai_job_id |
| `audit_log` | id, user_id, action, entity, entity_id, before jsonb null, after jsonb null, ip, created_at. Обязателен для: назначений, правок продуктов/рецептов, операций с учётными записями, выгрузок данных, привязки/отвязки Telegram |

Индексы: все fk; `(patient_id, occurred_at)` на дневниках; GIN по `to_tsvector('russian', name_ru)` на `products` и `recipes.title`.

---

## 5. Backend API (`apps/api`)

### 5.1. Конвенции

- Базовый префикс `/api/v1`. OpenAPI — источник для генерации `packages/api-client` (`make openapi`).
- Структура: `apps/api/src/{routers,deps,services}/`; доступ к БД — через репозитории из `packages/core`; в роутерах бизнес-логики нет.
- Ответ об ошибке: `{"error": {"code": "string", "message": "строка для пользователя (ru)", "details": {...}}}`. Коды: `validation_error`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `infeasible_calculation`, `rate_limited`, `internal`.
- Пагинация: `?limit=&offset=`, ответ `{"items": [...], "total": n}`.
- Все ручки с данными пациента используют зависимость `require_patient_access(patient_id)` — проверка связи через `parent_patient` / `doctor_patient` (админ к клиническим данным доступа **не имеет**).

### 5.2. Аутентификация

- JWT: access 15 мин + refresh 30 дней (httpOnly cookie для web; для Mini App — заголовок). Роль и user_id — в claims.
- 2FA (TOTP): для admin/doctor/dietitian вход = пароль → код. Родителю 2FA опциональна.
- Mini App: `POST /auth/telegram-init` — валидация подписи `initData` HMAC-ключом бота; если chat_id привязан → выдача токенов с ролью parent и scope конкретного пациента.
- Бот-сервис: сервисный токен (env `BOT_API_TOKEN`), действует от имени привязанного `telegram_accounts.parent_id`.

### 5.3. Эндпоинты (сводно)

| Группа | Ручки |
|---|---|
| `/auth` | `POST /login`, `POST /refresh`, `POST /logout`, `POST /totp/setup`, `POST /totp/verify`, `POST /invitations` (admin), `POST /invitations/accept`, `POST /telegram-init`, `POST /link-codes` (parent → код привязки бота) |
| `/patients` | CRUD профиля (create — parent при регистрации ребёнка или admin), `GET /patients/{id}/overview` (сводка для главной), `GET/PUT /patients/{id}/medical-profile` (doctor) |
| `/prescriptions` | `GET /patients/{id}/prescriptions` (история), `POST` (doctor; создаёт версию; событие для уведомления семьи) |
| `/medications` | CRUD схемы (doctor) |
| `/products` | `GET` (поиск q, категория, пагинация), `GET /{id}`, `POST/PUT` (admin/dietitian; пишет ревизию + audit), `POST /import` (CSV, admin) |
| `/recipes` | `GET` (фильтры: категория, ratio_min/max, только published для parent), CRUD (admin/dietitian), `POST /{id}/publish` — пересчитывает через engine и фиксирует engine_version |
| `/calc` | `POST /verify` (продукты+граммы → показатели+соответствие), `POST /solve` (продукты+цели → массы), `POST /scale` (рецепт+фактор). Все — тонкие обёртки над keto_engine; ответы включают engine_version |
| `/custom-dishes` | CRUD (parent) |
| `/menus` | `GET /patients/{id}/menus?date=`, `PUT` (upsert дня), `POST /items/{id}/eaten` |
| `/logs` | Единый стиль: `GET/POST/PATCH/DELETE /patients/{id}/logs/{seizures\|ketones\|weight\|medications\|meals\|side-effects}`; GET — фильтр по периоду |
| `/reports` | `GET /patients/{id}/report?from=&to=&format=json\|pdf\|csv`; PDF собирает worker (задача `render_report`), ручка возвращает job id + polling `GET /reports/jobs/{id}` |
| `/ai` | `POST /assistant/messages` (чат), `POST /parse` (свободный текст → структура, БЕЗ сохранения), `POST /patients/{id}/summary` (doctor; ставит задачу), `POST /summaries/{id}/approve` (doctor) |
| `/admin` | `GET/PATCH /users`, справочники, `GET /audit-log` (фильтры) |

### 5.4. Ключевые сценарии (последовательности)

- **Назначение:** doctor `POST /prescriptions` → строка в `prescriptions` + `audit_log` → задача воркеру `notify_family` → бот шлёт «Врач обновил назначение».
- **Ввод еды свободным текстом (бот):** бот → `POST /ai/parse` → ответ-структура → бот показывает подтверждение → при «Да» бот → `POST /logs/meals` с `source=ai_parsed`, `parsed=<структура>`.
- **AI-сводка:** doctor запускает → `ai_jobs(kind=doctor_summary)` → worker собирает ряды за период, псевдонимизирует, вызывает Claude → `doctor_summaries.draft_md` → врач редактирует и `approve` → только после этого сводка видна в отчётах.

---

## 6. Keto Engine (`packages/keto_engine`)

### 6.1. Контракт

Чистый пакет: **никаких** импортов из core/api, никакого I/O. Вход и выход — dataclass'ы/typed dict.

```python
@dataclass(frozen=True)
class Ingredient:      # значения на 100 г
    product_id: str
    kcal: float; fat: float; protein: float; carbs: float; fiber: float = 0.0

@dataclass(frozen=True)
class Targets:
    ratio: float                 # напр. 4.0 для 4:1
    kcal: float                  # целевая калорийность приёма/блюда
    protein_min_g: float | None = None
    carbs_max_g: float | None = None
    per_ingredient_bounds: dict[str, tuple[float, float]] | None = None  # min/max грамм

def verify(items: list[tuple[Ingredient, float]]) -> DishResult
def solve(ingredients: list[Ingredient], targets: Targets) -> SolveResult   # raises InfeasibleError(reason: str)
def scale(recipe: DishResult, factor: float) -> DishResult
ENGINE_VERSION: str   # semver, поднимать при любом изменении математики
```

### 6.2. Константы по умолчанию (до утверждения медицинской спецификацией)

Все — в `keto_engine/constants.py`, каждая с `# TODO(med)`:

| Константа | Значение по умолчанию |
|---|---|
| Энергия: жиры / белки / углеводы | 9 / 4 / 4 ккал/г |
| Учёт углеводов | общие (total); переключатель `net_carbs: bool` заложить, по умолчанию False |
| Допуск соответствия по соотношению | ±0.15 абсолютных единиц R |
| Допуск по калорийности приёма | ±5% |
| Округление масс | до 1 г |
| Минимальная реалистичная масса ингредиента | 2 г |

### 6.3. Режим solve

Линейная задача (scipy.optimize.linprog, метод HiGHS): переменные — граммы ингредиентов; ограничения — равенство соотношения (линеаризуется: `F − R·P − R·C = 0`), коридор калорийности, `protein ≥ min`, `carbs ≤ max`, границы по ингредиентам, аллергии (исключённые продукты не попадают на вход — фильтрует вызывающая сторона). Целевая функция — минимизация суммарного отклонения от середины коридора калорийности (вспомогательные переменные). При infeasible — определить, какое ограничение делает задачу неразрешимой (поочерёдное ослабление), и вернуть человекочитаемую причину: `"С выбранными продуктами недостижимо соотношение 4:1 — добавьте жировой компонент"`.

### 6.4. Тесты

- Эталоны: `docs/medical/reference-cases/*.yaml` — формат: вход (ингредиенты, цели/массы), ожидаемый выход, допуск. Параметризованный pytest грузит все файлы. До получения медицинских эталонов агент создаёт **временные** эталоны с пометкой `provisional: true` (посчитанные вручную по формулам этого ТЗ) — минимум 30 сценариев, включая: 4:1, 3:1, 2.5:1, 2:1; infeasible-случаи; нулевые углеводы; клетчатка; scale с нарушением границ.
- Property-based (hypothesis): `verify(solve(x))` всегда в допусках; `scale(r, 1.0) == r`; монотонность kcal по массам.
- Покрытие `keto_engine` — 100% строк.

---

## 7. Telegram-бот (`apps/bot`)

aiogram 3, Router/FSM, всё через API (сервисный токен), собственного доступа к БД нет.

### 7.1. Привязка

`/start <code>` (deep-link из веб-кабинета) → `POST /auth/link-codes/verify` → приветствие с именем ребёнка. `/start` без кода и без привязки → инструкция, где взять код. Несколько chat_id на семью — допустимо.

### 7.2. Главное меню (ReplyKeyboard)

`⚡ Приступ · 🩸 Кетоны · ⚖️ Вес · 🍽 Еда · 💊 Лекарства · 🙂 Самочувствие · 📱 Приложение (кнопка WebApp → Mini App)`

### 7.3. FSM-сценарии (каждый — 2–4 шага, инлайн-кнопки, всегда есть «Отмена»)

| Сценарий | Шаги |
|---|---|
| Приступ | тип (кнопки из справочника) → длительность (кнопки: <30 с, 30–60 с, 1–5 мин, >5 мин, ввести) → время (Сейчас / указать ЧЧ:ММ) → [комментарий] → сохранить → подтверждение «Записано ✓» |
| Кетоны | значение (число) → метод (Кровь/Моча) → сохранить |
| Вес | значение (число, кг) → сохранить |
| Еда | «Из меню на сегодня» (список menu_items кнопками → отметить eaten) или «Не по меню» → свободный текст → `POST /ai/parse` → карточка разбора → Подтвердить / Исправить / Отмена |
| Лекарства | список активных препаратов на сегодня → отметить принятые |
| Самочувствие | симптом (текст) → [описание] → сохранить |

Валидация чисел: кетоны 0–12 ммоль/л, вес 2–150 кг; вне диапазона — переспросить. Любой нераспознанный текст вне FSM → «Я умею записывать данные. Для остального откройте приложение 📱 или обратитесь к врачу».

### 7.4. Напоминания

Worker-задача по расписанию (cron в ARQ): персональные напоминания (кетоны, вес, лекарства — время настраивается в веб-кабинете) и «за сегодня нет записей» (одно, мягкое, время по умолчанию 20:00 Asia/Tashkent). Push об изменении назначения. Все тексты — в `apps/bot/src/texts.py`, согласуются с мед. командой.

### 7.5. Запреты

Бот не показывает параметры назначения, не считает, не отвечает на медицинские вопросы (в т.ч. через ассистента — ассистент доступен только в web/miniapp, где виден дисклеймер и журнал).

---

## 8. Web SPA (`apps/web`)

### 8.1. Каркас

Vite + React 19 + TS. TanStack Router: `/login`, `/app/*` (guard по роли из JWT). Разделы по ролям:

```
/app (parent)   : home | calculator | products | recipes | menu | diary | reports | assistant | settings
/app (doctor)   : patients | patients/:id (overview, prescription, medications, diary, reports, notes) | summaries
/app (admin)    : users | products | recipes | dictionaries | audit
```

Один билд; недоступные разделы не рендерятся и защищены guard'ом.

### 8.2. Дизайн-система (`packages/ui`)

- Tailwind 4 + shadcn/ui; компоненты копируются в `packages/ui/src/components` и переиспользуются web/miniapp.
- Токены темы — в словаре shadcn/ui (`background`, `card`, `foreground`, `primary`, `muted-foreground`, `border`, `destructive`), сверх него наши `warning` и `success`. Единственный источник значений — `packages/ui/src/styles/tokens.css`; палитра сине-синевато-серая, принята по референсу заказчика (ADR-0005). Радиус 12 px, тени мягкие. Шрифт: Inter (кириллица), fallback system-ui.
  Прежняя шалфейно-бежевая палитра и словарь `canvas/surface/ink/accent/line/danger` выведены из употребления; ссылки на них проверяет `packages/ui/src/styles/tokens.test.ts`.
- Обязательные общие компоненты: `RatioBadge` (напр. «3.9 : 1», цвет по соответствию допуску), `MacroBar` (Ж/Б/У полоса), `TrendChart` (Recharts, с вертикальными маркерами смены назначения), `DiaryEntryCard`, `WarningBanner`, `DataTable` (обёртка TanStack Table: сортировка, пагинация, пустое состояние).
- Доступность: focus-visible, aria-метки, контраст ≥ 4.5:1; крупные тач-цели (min 44 px) в интерфейсе родителя.
- Паттерны взаимодействия, состояния экранов, правила форм и адаптивность — в `docs/UI_GUIDE.md` (UI-канон, 22 правила). Раздел 8 задаёт состав экранов, канон — как они устроены; при конфликте приоритет у ТЗ.

### 8.3. Ключевые экраны и критерии приёмки

| Экран | Обязательное поведение |
|---|---|
| Родитель / Главная | Активное назначение; итоги дня против назначения (MacroBar + kcal); последние кетоны/вес; приступы за сегодня; 3 быстрые кнопки. Загрузка одним запросом `/patients/{id}/overview` |
| Калькулятор | 3 таба (проверить/подобрать/пересчитать); поиск продуктов с автодополнением; результат ≤ 1 с; infeasible показывается человекочитаемой причиной, не ошибкой; кнопка «Сохранить как моё блюдо» |
| Меню | День; слоты приёмов; добавление рецепта/блюда с фактором порции; итоги дня live; `WarningBanner` при выходе за допуски; копирование дня |
| Дневники | Таб на каждый тип; форма добавления ≤ 3 полей на экран; график периода с маркерами назначений; редактирование/мягкое удаление своих записей |
| Врач / Пациенты | DataTable с флагами: 🔴 нет данных ≥ N дней (default 3, `# TODO(med)`), 🟠 отклонение питания, 🟠 рост приступов неделя-к-неделе |
| Врач / Назначение | Форма с валидацией (ratio 1.0–5.0 шаг 0.5 или произвольное, kcal 500–3000); сохранение → баннер «Создана версия N, семья уведомлена»; таблица истории версий |
| Админ / Продукты | DataTable + фильтры; форма с обязательными source/version/verified_at; CSV-импорт с превью и отчётом об ошибках построчно; история ревизий позиции |
| Отчёт | Выбор периода; графики + таблицы; «Скачать PDF» (поллинг job); CSV (только doctor) |

### 8.4. Работа с API

Только через `packages/api-client` (генерируется из OpenAPI, ручных fetch нет). TanStack Query: ключи `['patient', id, 'menu', date]`-стиль; мутации инвалидируют затронутые ключи; оптимистичные апдейты только для `eaten`-чекбоксов.

### 8.5. i18n

`react-i18next`; все строки в `apps/web/src/locales/ru/*.json`; ключи по разделам (`calculator.solve.infeasible`). Жёстко зашитые строки в JSX — ошибка ревью.

---

## 9. Mini App (`apps/miniapp`)

- Отдельный Vite-билд, использует `packages/ui` и `packages/api-client`.
- Авторизация: `@telegram-apps/sdk-react` → `initData` → `POST /auth/telegram-init`. Если не привязан — экран с инструкцией по коду привязки.
- Состав (только parent-функции): Главная-сводка, Меню (отметки eaten), Калькулятор (все 3 режима), Рецепты (просмотр), Графики, Ассистент.
- Тема: маппинг Telegram themeParams → CSS-переменные дизайн-системы; поддержка тёмной темы обязательна; учёт safe-area.
- Не включать: настройки профиля, отчёты PDF, всё врачебное/админское.

---

## 10. Worker и AI-модуль (`apps/worker`)

### 10.1. Задачи ARQ

| Задача | Триггер | Действие |
|---|---|---|
| `parse_free_text` | `POST /ai/parse` (синхронно ждётся ответом ручки, таймаут 15 с) | Claude → структура (см. 10.3) |
| `assistant_reply` | сообщение ассистенту | RAG + Claude → ответ |
| `doctor_summary` | запрос врача | сбор рядов за период → Claude → draft_md |
| `render_report` | запрос PDF | HTML-шаблон (jinja2) → weasyprint → файл в volume, ссылка с истечением |
| `notify_family` | новое назначение | сообщение в привязанные chat_id |
| `reminders_cron` | cron */5 мин | персональные напоминания по настройкам |
| `content_draft` | админ/диетолог | черновик карточки рецепта; проверка базы продуктов на аномалии (значения вне физиологичных диапазонов, сумма макросов > 100 г) |

### 10.2. Общие правила вызова Claude API

- Один модуль `worker/src/ai/client.py`: ретраи (3, экспоненциально), таймауты, подсчёт токенов и стоимости → `ai_jobs`.
- Модель — из env (`AI_MODEL_FAST` для parse, `AI_MODEL_SMART` для summary/assistant); в коде имена моделей не хардкодятся.
- **Псевдонимизация:** в промпты не передаются ФИО, контакты, chat_id. Пациент = `patient <internal-short-id>, возраст X лет Y мес, пол`. Функция `pseudonymize(payload)` — единственная точка подготовки данных; юнит-тест проверяет отсутствие полей ФИО в выходе.
- Лимиты: на пользователя — N запросов ассистента/сутки (env, default 30); дневной бюджет проекта в USD (env); при превышении — `rate_limited` с понятным текстом.
- Деградация: если AI недоступен — «Еда»-сценарий бота предлагает выбрать из меню; ассистент показывает «временно недоступен»; ничего больше не ломается.

### 10.3. Разбор свободного текста (`parse_free_text`)

Вход: текст + контекст (список доступных product name/id — top-N по префиксному совпадению, активное назначение НЕ передаётся). Выход — строгий JSON (валидация pydantic, при невалидном — один повтор с указанием ошибки):

```json
{
  "kind": "meal" | "seizure" | "other",
  "meal": {"items": [{"product_id": "...", "grams": 120, "confidence": 0.9}], "unmatched": ["названия, не найденные в базе"]},
  "seizure": {"type_hint": "...", "duration_sec": 90, "count": 1},
  "clarification_needed": "вопрос пользователю или null"
}
```

Результат всегда показывается пользователю на подтверждение; сохранение — только после «Подтвердить».

### 10.4. Ассистент семьи

- База знаний: `docs/knowledge-base/*.md` — только утверждённые мед. командой материалы; индексация в pgvector ИЛИ простой полнотекст + реранк (решение зафиксировать ADR; для MVP достаточно полнотекста).
- Системный промпт — файл `worker/src/ai/prompts/assistant.md` (версионируется git; изменения — только PR с апрувом; в prompt: роль, запреты, стиль). Запреты в промпте и постфильтре: дозировки, изменение диеты/лекарств, интерпретация симптомов, диагнозы → шаблонный ответ «Этот вопрос нужно обсудить с лечащим врачом».
- Каждый ответ содержит дисклеймер (короткая строка под сообщением, из i18n).
- Вся переписка — в `ai_conversations`; врачу переписка его пациентов доступна для чтения.

### 10.5. AI-сводка для врача

Вход (после псевдонимизации): ряды за период — приступы (по дням/типам), кетоны, вес, выполнение меню (% дней с записями, средние отклонения), лекарственные отметки, версии назначений с датами. Промпт требует: только констатация наблюдаемых фактов и динамики, никаких рекомендаций по терапии; формат — markdown с фикс. секциями (Приступы / Кетоны / Вес / Питание / Приверженность / Замечания по данным). Выход — черновик; в UI помечен «Черновик ИИ — требует проверки врача»; в отчёты попадает только `approved_md`.

---

## 11. Безопасность

- Пароли — argon2id; сессии/refresh — ревокация при смене пароля.
- Rate limiting: `/auth/*` — 5/мин/IP; `/ai/*` — по разделу 10.2 (slowapi или nginx).
- CORS: только домены web и miniapp. Cookies: httpOnly, secure, samesite=lax.
- Заголовки: CSP, X-Frame-Options DENY (кроме miniapp — Telegram-контекст, для него отдельный host и политика), HSTS.
- Валидация Telegram `initData` строго по алгоритму HMAC-SHA256 с секретом бота; срок годности auth_date ≤ 1 час.
- `audit_log` — по списку из 4.2; middleware не логирует тела запросов с паролями/токенами.
- Бэкапы: `infra/scripts/backup.sh` — nightly pg_dump | gzip | age-шифрование → внешнее хранилище; retention 30 дней; `restore.sh` + ежемесячная проверка восстановления на стенде (чек-лист в infra/README).
- Удаление данных пациента по запросу: management-команда `python -m core.tools.erase_patient <id>` — физическое удаление после экспорта архива; фиксируется в audit_log.

---

## 12. Конфигурация (env)

`.env.example` обязан содержать (значения — фиктивные):

```
DATABASE_URL=postgresql+asyncpg://...
REDIS_URL=redis://...
SECRET_KEY=            # JWT
BOT_TOKEN=             # Telegram
BOT_API_TOKEN=         # сервисный токен бота для API
ANTHROPIC_API_KEY=
AI_MODEL_FAST=
AI_MODEL_SMART=
AI_DAILY_BUDGET_USD=10
AI_USER_DAILY_LIMIT=30
WEB_ORIGIN=https://app.example.uz
MINIAPP_ORIGIN=https://tma.example.uz
SENTRY_DSN=
TZ=Asia/Tashkent
```

---

## 13. CI/CD (`.github/workflows`)

1. **ci.yml** (PR + main): lint → mypy/tsc → pytest (postgres+redis сервисами) → эталонные тесты engine (отдельный job, обязательный) → vitest → build web/miniapp → docker build всех образов.
2. **e2e.yml** (main, nightly): docker compose up → сид тестовых данных → Playwright: сквозной сценарий «врач создаёт назначение → родитель собирает меню → вносит дневники → отчёт формируется».
3. **deploy.yml** (тег `v*`): push образов в registry → ssh-деплой compose на стенд/прод, `alembic upgrade head` перед переключением.

Merge в main запрещён при красном CI. Эталонные тесты engine нельзя пометить skip/xfail.

---

## 14. Definition of Done (для каждой задачи)

- [ ] Код соответствует конвенциям (lint/типы зелёные локально: `make lint`).
- [ ] Есть тесты: unit на логику; интеграционный на новый эндпоинт (happy + 403 + валидация); для engine — эталоны.
- [ ] Миграция (если менялась схема) применяется на чистую БД и на БД с данными (up), автогенерация не оставляет диффа.
- [ ] OpenAPI и `api-client` перегенерированы (`make openapi`), фронт компилируется.
- [ ] Пользовательские строки — через i18n; аудит пишется, если действие из списка 4.2.
- [ ] Обновлена документация: README приложения / ADR при отступлении от ТЗ / OPEN_QUESTIONS при новой медицинской неопределённости.
- [ ] PR-описание: что сделано, как проверить, скриншот UI (если менялся).

---

## 15. Порядок реализации (этапы = вехи из КП)

Агент выполняет этапы строго последовательно; внутри этапа — в указанном порядке. Веха закрывается, когда её критерий (из КП, продублирован здесь) выполнен и продемонстрирован на стенде.

**Этап 1 — Фундамент** (критерий: эталонные тесты зелёные; Swagger доступен)
1. Каркас монорепо, Makefile, docker-compose.dev, CI-скелет.
2. `packages/core`: конфиг, модели, первая миграция (все таблицы раздела 4), сиды справочников.
3. `packages/keto_engine`: constants, verify/scale, provisional-эталоны, тесты.
4. keto_engine: solve (linprog) + infeasible-диагностика + property-тесты.
5. `apps/api`: auth (JWT, 2FA, приглашения), RBAC-зависимости.
6. `/products` (+ CSV-импорт, ревизии, audit), `/patients`, `/prescriptions`, `/calc`.
7. `make openapi` → `packages/api-client` v0.

**Этап 2 — Веб-кабинеты** (критерий: сквозной сценарий на тестовых данных)
8. `packages/ui`: токены, базовые компоненты, Storybook-подобная страница-витрина (`/dev/ui`, только dev-сборка).
9. Каркас SPA: роутер, guards, layout'ы трёх ролей, login+2FA.
10. Родитель: главная, калькулятор, продукты/рецепты, меню.
11. `/logs` API + дневники + графики.
12. Врач: список пациентов с флагами, карта пациента, назначения, лекарства, заметки.
13. Админ: пользователи, продукты, рецепты (статусы+publish), справочники, аудит.
14. `/reports` + worker `render_report` (PDF) + CSV.

**Этап 3 — Telegram** (критерий: запись из бота видна врачу; Mini App работает в iOS/Android-клиентах)
15. `apps/bot`: привязка, меню, FSM-сценарии (без «Еда→текст»), валидации.
16. Worker: `reminders_cron`, `notify_family`; настройки напоминаний в веб-кабинете.
17. `apps/miniapp`: auth по initData, сводка, меню, калькулятор, графики.

**Этап 4 — AI** (критерий: функции работают в пределах промптов; сводка проходит цикл approve)
18. `worker/ai`: клиент, псевдонимизация (+тест), `ai_jobs`, лимиты/бюджет.
19. `parse_free_text` + сценарий «Еда → свободный текст» в боте и miniapp.
20. Ассистент: база знаний, промпт, постфильтр, чат в web+miniapp, журнал.
21. `doctor_summary` + UI черновик/approve; `content_draft` для админа.

**Этап 5 — Стабилизация** (критерий: чек-лист пилота закрыт)
22. E2E-набор Playwright; нагрузочный прогон (locust, 100 одновременных).
23. Security-проход: чек-лист раздела 11, зависимость-аудит (pip-audit, pnpm audit).
24. Импорт реальной базы продуктов и рецептов (инструменты + поддержка).
25. Прод-инфраструктура: compose, nginx, TLS, бэкапы+restore-тест, Sentry, документация администратора.

---

## 16. Чего агент не делает

- Не реализует: автогенерацию меню, исследовательский модуль, платежи, offline, узбекскую локализацию (только каркас i18n), нативные приложения.
- Не меняет медицинские константы, промпты и тексты уведомлений без указания в задаче.
- Не добавляет зависимости «на всякий случай»; новая зависимость — обоснование в PR.
- Не пишет в `prescriptions` UPDATE/DELETE; не делает физического удаления клинических данных вне `erase_patient`.
- Не отправляет реальные данные пациентов в какие-либо внешние сервисы, кроме Claude API через `pseudonymize`.
- Не публикует и не коммитит секреты, дампы БД, реальные ФИО в фикстурах (тестовые данные — вымышленные).

---

*Конец документа. При конфликте между этим ТЗ и кодом — приоритет у ТЗ; при конфликте между ТЗ и медицинской спецификацией — приоритет у медицинской спецификации, с фиксацией расхождения в `docs/adr/`.*
