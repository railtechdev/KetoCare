---
name: db-migrations
description: Изменение схемы PostgreSQL через Alembic в packages/core — новые таблицы, поля, индексы, enum, сиды справочников. Использовать при любой правке моделей SQLAlchemy или создании миграций.
---

# Миграции БД — процедура

Alembic живёт в `packages/core`: конфиг `packages/core/alembic.ini`
(`script_location = migrations`), ревизии — `packages/core/migrations/versions/`.

## Порядок

1. Правь модели в `packages/core/src/core/models/` (не сырой SQL).
2. `make makemigration m="краткое описание"` (под капотом —
   `cd packages/core && uv run alembic revision --autogenerate -m "..."`).
3. Открой сгенерированный файл и проверь руками: enum-типы, server_default,
   naming convention индексов, отсутствие случайных drop.
4. `make migrate` на чистой БД И на БД с сидами — оба прогона должны пройти.
5. Повторный autogenerate не должен давать нового диффа (пустая ревизия = модели и
   схема сошлись). Пустую ревизию удали.

## Инварианты схемы (ТЗ §4)

- PK — uuid (`gen_random_uuid()`); везде `created_at timestamptz not null default now()`.
- Клинические/дневниковые таблицы: `deleted_at` (мягкое удаление) + `source` (web|bot|miniapp|ai_parsed).
- `prescriptions` — append-only: в репозитории нет update/delete-методов; не добавляй их.
- `products` — каждая правка пишет снапшот в `product_revisions`.
- Денормализованные расчёты (recipes.computed, menus.totals) хранятся только вместе с `engine_version`.
- Индексы: все FK; `(patient_id, occurred_at)` на дневниках; GIN russian tsvector на products.name_ru и recipes.title.

## Запрещено

- Править файлы в `packages/core/migrations/versions/`, уже попавшие в git (хук заблокирует
  и Edit/Write, и запись через shell) — только новая ревизия.
- `op.execute` с DML в схемных миграциях; сиды справочников — отдельными data-миграциями.
- Физическое удаление клинических данных где-либо, кроме `core.tools.erase_patient`.
