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
LANDING_ROOT=/var/www/ketocare-landing
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

    # openapi.json и сам сгенерированный клиент в git не попадают (.gitignore),
    # то есть на свежем клоне их нет вовсе — а `generate` читает именно файл.
    # Первый деплой на чистом сервере падал здесь с ENOENT.
    #
    # Выгружаем из уже собранного образа, а не с хоста: python и uv на сервере
    # не устанавливаются вовсе (docs/DEPLOY.md, «Однократная настройка»), API
    # живёт только в контейнере. Каталог монтируется в /out, чтобы не заслонить
    # /app с исходниками внутри образа.
    $COMPOSE run --rm --no-deps -v "$PWD/apps/api:/out" api \
        python apps/api/scripts/export_openapi.py /out/openapi.json

    # Тот же порядок, что в CI: клиент генерируется до сборки.
    pnpm --filter @ketocare/api-client run generate
    NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @ketocare/web run build
    rsync -a --delete apps/web/dist/ "$WEB_ROOT"/

    # Посадочная страница (Astro, ADR-0012). Адреса домена и кабинета уходят в
    # сборку: из них собираются canonical, hreflang, sitemap и ссылки «Войти».
    LANDING_SITE_URL="${LANDING_SITE_URL:-https://ketocare.railtech.uz}" \
    PUBLIC_APP_URL="${PUBLIC_APP_URL:-https://app.ketocare.railtech.uz}" \
    PUBLIC_CONTACT_EMAIL="${PUBLIC_CONTACT_EMAIL:-hello@ketocare.uz}" \
    NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @ketocare/landing run build
    rsync -a --delete packages/landing/dist/ "$LANDING_ROOT"/
fi

$COMPOSE ps
echo "Деплой завершён: $(git rev-parse --short HEAD)"
