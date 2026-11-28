#!/usr/bin/env bash
# Перенос данных с прежнего сервера на новый (docs/MIGRATION_2026-11.md, ADR-0095).
#
#   migrate-server.sh check    <прежний> <новый>   # только сверка, ничего не меняет
#   migrate-server.sh rehearse <прежний> <новый>   # репетиция: прежний работает
#   migrate-server.sh cutover  <прежний> <новый>   # перенос: прежний останавливается
#   migrate-server.sh rollback <прежний> <новый>   # откат: прежний снова работает
#
# <прежний> и <новый> — имена из ~/.ssh/config с входом под root. Запускается с
# машины того, кто переносит: данные идут потоком между двумя ssh-соединениями,
# на диск этой машины не ложатся и на экран не выводятся.
#
# Переносится всё, от чего зависит доступ людей и история детей:
#   • база целиком — учётные записи, пароли, второй фактор, сессии, привязки
#     Telegram, карты пациентов;
#   • тома `attachments` (документы пациентов) и `erased` (архивы стирания);
#   • снимок redis — секреты привязок бота: без них бот не узнаёт ни одну семью.
# Том `reports` не переносится: PDF пересобирается из базы.
#
#   • ключи приложения, от которых зависят данные: `SECRET_KEY` расшифровывает
#     ключи ИИ, введённые в кабинете, `BOT_TOKEN` — бот, к которому привязаны
#     семьи. Они уходят с сервера на сервер и в GitHub не попадают.
#
# Новый сервер к этому моменту настроен (bootstrap-server.sh с STANDBY=1) и на
# него выкачен тот же или более новый коммит.
#
# Почему бот и воркер нового сервера стоят до переноса — см. deploy.sh, «режим
# ожидания»: один токен бота опрашивается только из одного места.

set -euo pipefail

MODE="${1:-}"
OLD="${2:-}"
NEW="${3:-}"

usage() {
    sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
    exit 64
}
case "$MODE" in check|rehearse|cutover|rollback) ;; *) usage ;; esac
[ -n "$OLD" ] && [ -n "$NEW" ] || usage
[ "$OLD" != "$NEW" ] || { echo "Прежний и новый — один и тот же сервер" >&2; exit 64; }

REPO=/srv/ketocare
# Одной строкой уходит на сервер: каталог и compose с окружением этого сервера.
C="cd $REPO && docker compose --env-file .env -f infra/docker-compose.prod.yml"
# От имени владельца рабочего дерева: root-у git отказывает («dubious ownership»).
GIT="runuser -u ketocare -- git -C $REPO"
SSH=(ssh -o BatchMode=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=10)

say() { echo; echo "### $*"; }
fail() { echo "ОСТАНОВЛЕНО: $*" >&2; exit 1; }
on() { local host="$1"; shift; "${SSH[@]}" "$host" "$@"; }

# --- сверка -----------------------------------------------------------------

#: Число строк в каждой таблице — одной колонкой «таблица число». Это счёт, а не
#: содержимое: по нему видно, что база приехала целиком, и ничего о пациентах.
ROWS_SQL="SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"

rows_of() { on "$1" "$C exec -T postgres psql -U ketocare -d ketocare -At -c \"$ROWS_SQL\""; }
schema_of() {
    on "$1" "$C exec -T postgres psql -U ketocare -d ketocare -At -c 'SELECT version_num FROM alembic_version'"
}
volume_stat() {
    # «файлов байт» тома: сверка, что документы приехали все и целыми.
    on "$1" "docker run --rm -v ketocare_$2:/data:ro alpine sh -c 'echo \$(find /data -type f | wc -l) \$(find /data -type f -exec cat {} + | wc -c)'"
}
redis_keys() { on "$1" "$C exec -T redis redis-cli DBSIZE" | tr -dc '0-9'; }

preflight() {
    say "проверка серверов"
    on "$OLD" true || fail "нет входа на прежний сервер ($OLD)"
    on "$NEW" true || fail "нет входа на новый сервер ($NEW)"

    local mark
    mark="$(on "$NEW" "cat /etc/ketocare/environment 2>/dev/null || true" | tr -d '[:space:]')"
    [ "$mark" = "production" ] || fail "новый сервер размечен как «${mark:-без метки}», а данные едут только на production"
    # Обратная ошибка — перепутать аргументы и залить пустую базу нового сервера
    # поверх настоящей. У прежнего сервера метки production нет и быть не может.
    mark="$(on "$OLD" "cat /etc/ketocare/environment 2>/dev/null || true" | tr -d '[:space:]')"
    [ "$mark" != "production" ] || fail "«прежний» сервер ($OLD) размечен как production — аргументы перепутаны?"

    on "$NEW" "test -f /etc/ketocare/secrets.env && test -f $REPO/.env.config" \
        || fail "на новом сервере нет ключей сервера или настроек выката — сначала bootstrap-server.sh и первый выкат"

    for volume in pgdata redisdata attachments erased; do
        on "$NEW" "docker volume inspect ketocare_$volume >/dev/null 2>&1" \
            || fail "на новом сервере нет тома ketocare_$volume — сначала первый выкат"
    done

    local old_commit new_commit
    old_commit="$(on "$OLD" "$GIT rev-parse HEAD")"
    new_commit="$(on "$NEW" "$GIT rev-parse HEAD")"
    echo "прежний: $old_commit"
    echo "новый:   $new_commit"
    # Новый обязан быть не старее: дамп старой схемы догоняется миграциями, а
    # дамп НОВОЙ схемы в старый код не лезет.
    on "$NEW" "$GIT fetch --quiet origin && $GIT merge-base --is-ancestor $old_commit $new_commit" \
        || fail "на новом сервере код старее, чем на прежнем — сначала выкат"

    local old_pg new_pg
    old_pg="$(on "$OLD" "$C exec -T postgres psql -U ketocare -d ketocare -At -c 'SHOW server_version_num'" | cut -c1-2)"
    new_pg="$(on "$NEW" "$C exec -T postgres psql -U ketocare -d postgres -At -c 'SHOW server_version_num'" | cut -c1-2)"
    [ "$old_pg" = "$new_pg" ] || fail "PostgreSQL разных основных версий: $old_pg и $new_pg"
    echo "PostgreSQL $old_pg на обоих"

    if [ "$MODE" != "rollback" ]; then
        on "$NEW" "test -f /etc/ketocare/standby" \
            || fail "новый сервер НЕ в режиме ожидания: его бот уже опрашивает Telegram. Перенос на работающий сервер стёр бы его данные"
    fi
    echo "прежний: таблиц $(rows_of "$OLD" | wc -l), схема $(schema_of "$OLD"), ключей redis $(redis_keys "$OLD")"
    echo "  документы: $(volume_stat "$OLD" attachments) (файлов байт), архивы стирания: $(volume_stat "$OLD" erased)"
}

# --- перенос ----------------------------------------------------------------

#: Что на боевом обязано остаться ПРЕЖНИМ. Остальные ключи у нового сервера
#: свои (пароль базы, ключ связи бота с API): от их значения ничьи данные не
#: зависят.
#:   SECRET_KEY, SETTINGS_ENCRYPTION_KEY — расшифровывают ключи ИИ, введённые в
#:     кабинете; отдельного ключа шифрования на прежнем сервере могло не быть,
#:     и тогда его не должно быть и на новом (server-secrets.sh, mirror);
#:   BOT_TOKEN, BOT_USERNAME — бот, к которому привязаны семьи; уйдут в кабинет
#:     вместе с разделом интеграций;
#:   остальное — запасные значения, которые кабинет уже перекрывает.
MIRRORED_KEYS="SECRET_KEY SETTINGS_ENCRYPTION_KEY BOT_TOKEN BOT_USERNAME ANTHROPIC_API_KEY AI_MODEL_FAST AI_MODEL_SMART SENTRY_DSN BACKUP_AGE_RECIPIENT"

copy_keys() {
    say "ключи приложения"
    local pattern="${MIRRORED_KEYS// /|}"
    # Значения идут потоком между серверами; печатаются только имена.
    on "$OLD" "grep -E '^($pattern)=' $REPO/.env || true" \
        | on "$NEW" "bash $REPO/infra/scripts/server-secrets.sh mirror $MIRRORED_KEYS >/dev/null"
    # Окружение приложения пересобирается из настроек последнего выката и
    # обновлённых ключей — так же, как это делает сам выкат.
    on "$NEW" "cd $REPO && test -f .env.config \
        && ( umask 077; bash infra/scripts/server-secrets.sh render .env.config > .env.next ) \
        && chown --reference=.env.config .env.next && mv .env.next .env" \
        || fail "окружение нового сервера не пересобрано — был ли на нём выкат?"
    echo "на новом сервере: $(on "$NEW" "bash $REPO/infra/scripts/server-secrets.sh names" | tr '\n' ' ')"
}

copy_database() {
    say "база"
    on "$NEW" "$C stop api bot worker >/dev/null 2>&1; $C up -d postgres >/dev/null 2>&1"
    # База нового сервера пересоздаётся: в ней пустая схема первого выката или
    # копия прошлой репетиции. `pg_restore --clean` по живой схеме оставил бы
    # всё, чего нет в дампе.
    on "$NEW" "$C exec -T postgres psql -U ketocare -d postgres -v ON_ERROR_STOP=1 -q \
        -c 'DROP DATABASE IF EXISTS ketocare WITH (FORCE)' -c 'CREATE DATABASE ketocare OWNER ketocare'"
    on "$OLD" "$C exec -T postgres pg_dump -U ketocare -Fc ketocare" \
        | on "$NEW" "$C exec -T postgres pg_restore -U ketocare -d ketocare --no-owner --exit-on-error"
    echo "развёрнута: таблиц $(rows_of "$NEW" | wc -l), схема $(schema_of "$NEW")"
}

copy_volume() {
    local volume="$1"
    say "том $volume"
    on "$OLD" "docker run --rm -v ketocare_$volume:/data:ro alpine tar cf - -C /data ." \
        | on "$NEW" "docker run --rm -i -v ketocare_$volume:/data alpine sh -c 'find /data -mindepth 1 -delete && tar xf - -C /data'"
    local was now
    was="$(volume_stat "$OLD" "$volume")"
    now="$(volume_stat "$NEW" "$volume")"
    echo "прежний: $was, новый: $now (файлов байт)"
    [ "$was" = "$now" ] || fail "том $volume приехал не целиком"
}

copy_redis() {
    say "redis"
    on "$NEW" "$C stop redis >/dev/null 2>&1"
    # Снимок кладётся как dump.rdb, каталог AOF убирается. Владелец — как у
    # каталога данных.
    on "$OLD" "$C exec -T redis sh -c 'redis-cli SAVE >/dev/null && cat /data/dump.rdb'" \
        | on "$NEW" "docker run --rm -i -v ketocare_redisdata:/data alpine sh -c 'rm -rf /data/appendonlydir /data/dump.rdb && cat > /data/dump.rdb && [ -s /data/dump.rdb ] && chown \$(stat -c %u:%g /data) /data/dump.rdb'"
    # Положить снимок мало. Наш redis работает с журналом (`--appendonly yes`),
    # а redis 7 при включённом журнале снимок НЕ читает: не найдя журнала, он
    # заводит пустой — и поднимается без единого ключа (так и вышло на
    # репетиции 28.11.2026; прежняя инструкция в DEPLOY.md обещала обратное).
    # Поэтому снимок один раз поднимается без журнала, журнал включается на
    # ходу — redis переписывает в него всё, что в памяти, — и только после
    # этого запускается штатный контейнер.
    on "$NEW" "bash -s" <<'REMOTE'
set -euo pipefail
name=ketocare-redis-import
cli() { docker exec "$name" redis-cli "$@" | tr -d '\r'; }
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" -v ketocare_redisdata:/data redis:7 redis-server --appendonly no >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 20); do cli ping 2>/dev/null | grep -q PONG && break; sleep 1; done
cli CONFIG SET appendonly yes >/dev/null
for _ in $(seq 1 60); do
    state="$(cli INFO persistence)"
    if printf '%s\n' "$state" | grep -qx 'aof_enabled:1' \
       && printf '%s\n' "$state" | grep -qx 'aof_rewrite_in_progress:0' \
       && printf '%s\n' "$state" | grep -qx 'aof_rewrite_scheduled:0' \
       && printf '%s\n' "$state" | grep -qx 'aof_last_bgrewrite_status:ok'; then
        cli SHUTDOWN >/dev/null 2>&1 || true
        exit 0
    fi
    sleep 1
done
echo "журнал redis не переписан за минуту" >&2
exit 1
REMOTE
    on "$NEW" "$C up -d redis >/dev/null 2>&1"
    sleep 3
    local was now
    was="$(redis_keys "$OLD")"
    now="$(redis_keys "$NEW")"
    echo "ключей: прежний $was, новый $now"
    [ "$now" -gt 0 ] || [ "$was" -eq 0 ] || fail "redis на новом сервере пуст — снимок не прочитан"
}

compare_rows() {
    # $1 = strict | loose. На репетиции прежний сервер работает, и пока шёл
    # дамп, семьи могли дописать записи: расхождение — предупреждение. На
    # переносе прежний остановлен, и расхождение — отказ.
    say "сверка строк"
    local was now
    was="$(rows_of "$OLD")"
    now="$(rows_of "$NEW")"
    if [ "$was" = "$now" ]; then
        echo "совпали все $(printf '%s\n' "$was" | wc -l) таблиц"
        return 0
    fi
    echo "расходятся (таблица: было → стало):"
    diff <(printf '%s\n' "$was") <(printf '%s\n' "$now") | grep '^[<>]' | sed 's/^/  /' || true
    [ "$1" = "loose" ] || fail "после остановки прежнего сервера строки обязаны совпасть"
    echo "на репетиции это ожидаемо: прежний сервер продолжал работать"
}

finish_new() {
    say "новый сервер: миграции и индекс"
    on "$NEW" "$C run --rm api sh -c 'cd packages/core && python -m alembic upgrade head' >/dev/null"
    on "$NEW" "$C run --rm api python -m core.tools.index_knowledge_base >/dev/null"
    echo "схема: $(schema_of "$NEW")"
}

health() {
    on "$NEW" "for i in 1 2 3 4 5 6 7 8 9 10; do curl -fsS --max-time 5 http://127.0.0.1:8001/health >/dev/null 2>&1 && exit 0; sleep 3; done; exit 1" \
        || fail "API нового сервера не отвечает"
    echo "API нового сервера отвечает"
}

# --- режимы -----------------------------------------------------------------

case "$MODE" in
    check)
        preflight
        echo
        echo "Сверка пройдена, ничего не изменено."
        ;;

    rehearse)
        preflight
        copy_keys
        copy_database
        compare_rows loose
        copy_volume attachments
        copy_volume erased
        copy_redis
        finish_new
        # Поднимается только API: бот и воркер остаются выключенными — на
        # новом сервере теперь настоящие привязки и настоящие расписания.
        on "$NEW" "$C up -d api >/dev/null 2>&1"
        health
        echo
        echo "Репетиция пройдена. Новый сервер остаётся в режиме ожидания."
        ;;

    cutover)
        preflight
        say "прежний сервер: остановка бота, воркера и API"
        # Сначала бот: с этой секунды Telegram копит сообщения семей и отдаст
        # их боту нового сервера. Postgres и redis остаются — из них снимается
        # копия.
        on "$OLD" "$C stop bot worker api"
        STOPPED_AT="$(date '+%H:%M:%S')"
        copy_keys
        copy_database
        compare_rows strict
        copy_volume attachments
        copy_volume erased
        copy_redis
        finish_new
        say "новый сервер: выход из режима ожидания"
        on "$NEW" "rm -f /etc/ketocare/standby && $C up -d >/dev/null 2>&1"
        health
        on "$NEW" "$C ps --format '{{.Service}} {{.State}}'" | sed 's/^/  /'
        echo
        echo "Перенос выполнен. Прежний сервер остановлен в $STOPPED_AT и НЕ запускается сам."
        echo "Дальше — по листу (docs/MIGRATION_2026-11.md): проверка входов, DNS прежних имён,"
        echo "сертификат на них. Откат, пока DNS не переключён: $0 rollback $OLD $NEW"
        ;;

    rollback)
        preflight
        say "новый сервер: обратно в режим ожидания"
        # Сначала глушится бот нового: два бота с одним токеном отбирают
        # сообщения друг у друга.
        on "$NEW" "touch /etc/ketocare/standby && $C stop bot worker"
        say "прежний сервер: запуск"
        on "$OLD" "$C up -d >/dev/null 2>&1"
        on "$OLD" "$C ps --format '{{.Service}} {{.State}}'" | sed 's/^/  /'
        echo
        echo "Откат выполнен: работает прежний сервер. Записи, сделанные на новом после"
        echo "переноса, остались на новом — перед повторным переносом решить, что с ними."
        ;;
esac
