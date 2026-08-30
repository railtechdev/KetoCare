#!/usr/bin/env bash
# Деплой пред-прода на VPS. Запускается на сервере из любого каталога:
#
#   infra/scripts/deploy.sh            # всё: образы, миграции, фронт
#   infra/scripts/deploy.sh --api-only # без пересборки фронта (быстрее)
#
# Предусловия (однократная настройка сервера) — docs/DEPLOY.md.
set -euo pipefail

cd "$(dirname "$0")/../.."

WEB_ROOT=/var/www/ketocare-app
COMPOSE="docker compose --env-file .env -f infra/docker-compose.prod.yml"

git pull --ff-only

$COMPOSE build
$COMPOSE up -d postgres redis

# Миграции — до пересоздания приложений. Пока alembic работает, СТАРЫЕ
# контейнеры продолжают обслуживать запросы по уже обновлённой схеме — короткое
# окно несовместимости на пред-проде принято ради деплоя без даунтайма; поэтому
# миграции должны быть аддитивными (новые таблицы/колонки, без переименований).
$COMPOSE run --rm api sh -c "cd packages/core && python -m alembic upgrade head"

$COMPOSE up -d

if [ "${1:-}" != "--api-only" ]; then
    # Сборка фронта на хосте (node 22 + corepack, см. docs/DEPLOY.md).
    # Лимит памяти node — VPS с 2 ГБ RAM, рядом работают postgres и api.
    corepack enable >/dev/null 2>&1 || true
    pnpm install --frozen-lockfile
    # Тот же порядок, что в CI: клиент генерируется до сборки.
    pnpm --filter @ketocare/api-client run generate
    NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @ketocare/web run build
    rsync -a --delete apps/web/dist/ "$WEB_ROOT"/
fi

$COMPOSE ps
echo "Деплой завершён: $(git rev-parse --short HEAD)"
