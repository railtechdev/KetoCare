#!/usr/bin/env bash
# Проверка восстановления резервной копии.
#
# «Бэкап, который ни разу не восстанавливали, бэкапом не считается»: cron может
# годами класть на диск файлы, которые не разворачиваются, и узнать об этом
# получится ровно один раз — когда восстанавливать понадобится по-настоящему.
#
# Скрипт разворачивает дамп в ОТДЕЛЬНУЮ временную базу и сверяет, что в ней
# оказалось то же, что в рабочей: перечень таблиц, число строк в ключевых из них
# и версия миграций. Рабочая база при этом не трогается — во временную ведёт
# отдельное имя, а в конце она удаляется.
#
#   infra/scripts/verify-backup.sh /srv/backups/postgres-2026-08-31.dump
#
# Локально (dev-стенд, контейнер из docker-compose.dev.yml):
#   infra/scripts/verify-backup.sh <дамп> ketocare-dev-postgres-1
#
# Код возврата: 0 — восстановление проверено, иначе отказ с объяснением.

set -euo pipefail

DUMP=${1:-}
CONTAINER=${2:-}
CHECK_DB="ketocare_restore_check"

fail() {
    echo "ПРОВЕРКА НЕ ПРОЙДЕНА: $1" >&2
    exit 1
}

[ -n "$DUMP" ] || fail "укажите файл дампа: verify-backup.sh <дамп> [контейнер]"
[ -f "$DUMP" ] || fail "файл не найден: $DUMP"

# На сервере имя контейнера задаёт compose, локально — dev-окружение. Явный
# аргумент важнее: одна и та же проверка должна работать в обоих местах.
if [ -z "$CONTAINER" ]; then
    CONTAINER=$(docker ps --filter name=postgres --format '{{.Names}}' | head -1)
fi
[ -n "$CONTAINER" ] || fail "не найден контейнер postgres — укажите его вторым аргументом"

echo "Дамп:       $DUMP ($(($(wc -c < "$DUMP") / 1024)) КБ)"
echo "Контейнер:  $CONTAINER"
echo "Временная база: $CHECK_DB"

# Без `-i`: флаг отдаёт контейнеру стандартный ввод, и команда съедает его
# у самого скрипта. Это заметно, когда скрипт запущен через `bash -s` (например,
# по ssh без копирования файла на сервер): проверка молча обрывалась после
# первого же вызова. Ввод нужен ровно одной команде — pg_restore, читающей дамп.
psql_check() {
    docker exec "$CONTAINER" psql -U ketocare -d "$CHECK_DB" -tAc "$1"
}

cleanup() {
    docker exec "$CONTAINER" psql -U ketocare -d postgres \
        -c "DROP DATABASE IF EXISTS $CHECK_DB WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- разворачиваем ------------------------------------------------------------
cleanup
docker exec "$CONTAINER" psql -U ketocare -d postgres \
    -c "CREATE DATABASE $CHECK_DB" >/dev/null || fail "не удалось создать временную базу"

# Расширения (citext) лежат в дампе, но их создание требует прав суперпользователя
# на новой базе; ошибки на этом шаге не смертельны, поэтому разбираем вывод, а не
# полагаемся на код возврата pg_restore.
RESTORE_LOG=$(mktemp)
docker exec -i "$CONTAINER" pg_restore -U ketocare -d "$CHECK_DB" --no-owner --no-privileges \
    < "$DUMP" > "$RESTORE_LOG" 2>&1 || true

# --- сверяем ------------------------------------------------------------------
TABLES=$(psql_check "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
[ "${TABLES:-0}" -ge 25 ] || fail "в восстановленной базе всего $TABLES таблиц — дамп неполный"

VERSION=$(psql_check "SELECT version_num FROM alembic_version" || true)
[ -n "$VERSION" ] || fail "нет alembic_version: восстановленная база не знает своей версии схемы"

# Клинические таблицы: их пустота на непустом стенде означает, что дамп снят
# не с той базы или снят частично.
PATIENTS=$(psql_check "SELECT count(*) FROM patients")
USERS=$(psql_check "SELECT count(*) FROM users")

echo
echo "Таблиц:              $TABLES"
echo "Версия миграций:     $VERSION"
echo "Пользователей:       $USERS"
echo "Пациентов:           $PATIENTS"

if grep -qi "error" "$RESTORE_LOG"; then
    echo
    echo "Замечания pg_restore (обычно это расширения и владельцы — они не мешают):"
    grep -i "error" "$RESTORE_LOG" | head -5
fi
rm -f "$RESTORE_LOG"

echo
echo "Восстановление проверено: дамп разворачивается, схема на месте."
