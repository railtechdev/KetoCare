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
MINIAPP_ROOT=/var/www/ketocare-miniapp
LANDING_ROOT=/var/www/ketocare-landing
COMPOSE="docker compose --env-file .env -f infra/docker-compose.prod.yml"

# Корневой `.env` — единственное место объявления настроек (CLAUDE.md), и
# сборка лендинга обязана читать его же. `--env-file` выше относится только к
# docker compose: без этой строки оператор вписывал рабочую почту в `.env`,
# видел успешный деплой — а в подвале на трёх языках оставались адреса из
# макета, которые никто не читает.
#
# `set -a` экспортирует всё присвоенное, чтобы значения дошли до дочерних
# процессов сборки; при `set -u` (включён выше) отсутствие файла — это отказ, а
# не тихая работа на умолчаниях.
if [ -f .env ]; then
    set -a
    . ./.env
    set +a
else
    echo "Нет .env — скопируйте .env.example и заполните (docs/DEPLOY.md)." >&2
    exit 1
fi

# Автодеплой (.github/workflows/deploy.yml) сам переводит рабочую копию на тот
# коммит, на котором зеленел CI, и приходит сюда с отсоединённым HEAD. `git pull`
# на нём падает: «You are not currently on a branch». Ручной запуск на сервере
# по-прежнему подтягивает вершину ветки.
if git symbolic-ref --quiet HEAD >/dev/null; then
    git pull --ff-only
else
    echo "Отсоединённый HEAD — код уже на нужном коммите: $(git rev-parse --short HEAD)"
fi

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
    # Без этого corepack при первом запуске (и после каждой смены версии pnpm в
    # `packageManager`) спрашивает подтверждение загрузки. В автодеплое отвечать
    # некому: задача GitHub Actions висит до таймаута, а в журнале — тишина.
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
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

    # Telegram Mini App (ADR-0017). Каталог создаётся здесь же: пока в nginx нет
    # его server-блока, собранные файлы просто лежат и никому не мешают — выкат
    # приложения и настройка домена разнесены намеренно, домен заводит человек.
    NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @ketocare/miniapp run build
    mkdir -p "$MINIAPP_ROOT"
    rsync -a --delete apps/miniapp/dist/ "$MINIAPP_ROOT"/

    # Посадочная страница (Astro, ADR-0012). Адреса домена и кабинета уходят в
    # сборку: из них собираются canonical, hreflang, sitemap и ссылки «Войти».
    # Все пять переменных лендинга перечислены явно: они приходят из `.env`
    # (см. загрузку выше), а умолчания остаются на случай пустого значения.
    # `LANDING_INDEXABLE` пуст на пред-проде и равен `1` на боевом домене —
    # без него robots.txt отдаёт Disallow, и сайт не появится в поиске.
    LANDING_SITE_URL="${LANDING_SITE_URL:-https://ketocare.railtech.uz}" \
    LANDING_INDEXABLE="${LANDING_INDEXABLE:-}" \
    PUBLIC_APP_URL="${PUBLIC_APP_URL:-https://app.ketocare.railtech.uz}" \
    PUBLIC_CONTACT_EMAIL="${PUBLIC_CONTACT_EMAIL:-hello@ketocare.uz}" \
    PUBLIC_TELEGRAM_URL="${PUBLIC_TELEGRAM_URL:-https://t.me/ketocare}" \
    NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @ketocare/landing run build
    rsync -a --delete packages/landing/dist/ "$LANDING_ROOT"/
fi

$COMPOSE ps
echo "Деплой завершён: $(git rev-parse --short HEAD)"
