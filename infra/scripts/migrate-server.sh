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
#:   MONITOR_TOKEN — им монитор доступности проверяет ИИ; на переносе
#:     28.11.2026 без него проверка ИИ сразу покраснела;
#:   остальное — запасные значения, которые кабинет уже перекрывает.
MIRRORED_KEYS="SECRET_KEY SETTINGS_ENCRYPTION_KEY BOT_TOKEN BOT_USERNAME MONITOR_TOKEN ANTHROPIC_API_KEY AI_MODEL_FAST AI_MODEL_SMART SENTRY_DSN BACKUP_AGE_RECIPIENT"

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

# --- прежние адреса -----------------------------------------------------------

#: Имя посадочной из окружения сервера: кабинет — app.<имя>, Mini App — tma.<имя>.
landing_of() {
    on "$1" "sed -n 's|^LANDING_SITE_URL=.\{0,1\}https://\([a-z0-9.-]*\).*|\1|p' $REPO/.env | head -1"
}

redirect_old() {
    # Прежние адреса — закладки врачей, ссылки на распечатках, кнопки в старых
    # сообщениях бота. Пока их DNS не переключён на новый сервер, они ведут
    # сюда, на остановленный: здесь и отвечаем перенаправлением на новые имена,
    # тем же сертификатом. Сайты прежнего сервера не удаляются, а выключаются —
    # откат включает их обратно.
    say "прежний сервер: адреса перенаправляют на новые"
    local old_name new_name
    old_name="$(landing_of "$OLD")"
    new_name="$(landing_of "$NEW")"
    [ -n "$old_name" ] && [ -n "$new_name" ] || fail "не удалось прочитать имена серверов из окружения"
    on "$OLD" "bash -s -- '$old_name' '$new_name'" <<'REMOTE'
set -euo pipefail
old="$1"; new="$2"
cert="/etc/letsencrypt/live/$old"
[ -f "$cert/fullchain.pem" ] || { echo "нет сертификата $cert" >&2; exit 1; }
conf=/etc/nginx/sites-available/ketocare-moved.conf
{
    first=1
    for prefix in "" "app." "tma."; do
        v6="listen [::]:443 ssl;"
        [ "$first" = 1 ] && v6="listen [::]:443 ssl ipv6only=on;"
        first=0
        cat <<EOF
server {
    listen 443 ssl;
    $v6
    server_name ${prefix}${old};
    ssl_certificate $cert/fullchain.pem;
    ssl_certificate_key $cert/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    return 301 https://${prefix}${new}\$request_uri;
}
server {
    listen 80;
    listen [::]:80;
    server_name ${prefix}${old};
    return 301 https://${prefix}${new}\$request_uri;
}
EOF
    done
} > "$conf"
mkdir -p /etc/nginx/sites-disabled-by-move
for site in ketocare-landing ketocare-app ketocare-miniapp; do
    [ -L "/etc/nginx/sites-enabled/$site.conf" ] && mv "/etc/nginx/sites-enabled/$site.conf" /etc/nginx/sites-disabled-by-move/
done
ln -sf "$conf" /etc/nginx/sites-enabled/ketocare-moved.conf
if ! nginx -t >/dev/null 2>&1; then
    rm -f /etc/nginx/sites-enabled/ketocare-moved.conf
    mv /etc/nginx/sites-disabled-by-move/*.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
    echo "nginx не принял перенаправление — прежние сайты возвращены" >&2
    exit 1
fi
systemctl reload nginx
REMOTE
    echo "https://app.$old_name → https://app.$new_name"
}

relay_old() {
    # Новые имена ещё не открываются (DNS): люди продолжают ходить по прежним
    # адресам, а прежний сервер пересылает их новому SSH-туннелем
    # (interim-relay.sh). Окончательные имена нового сервера — в NEW_NAME:
    # его окружение на это время смотрит на прежние.
    say "прежний сервер: адреса пересылаются на новый"
    local old_name new_ip
    old_name="$(landing_of "$OLD")"
    new_ip="$(ssh -G "$NEW" | awk '/^hostname /{print $2}')"
    [ -n "${NEW_NAME:-}" ] || fail "для OLD_MODE=relay задайте NEW_NAME — окончательное имя нового сервера"
    on "$OLD" "/usr/local/sbin/ketocare-interim-relay old-up '$new_ip' '$old_name' '$NEW_NAME'"
}

restore_old() {
    say "прежний сервер: свои адреса обратно"
    on "$OLD" "if [ -f /srv/ketocare-deploy.sh.disabled-by-move ]; then mv /srv/ketocare-deploy.sh.disabled-by-move /srv/ketocare-deploy.sh; fi"
    on "$OLD" "if [ -x /usr/local/sbin/ketocare-interim-relay ]; then /usr/local/sbin/ketocare-interim-relay old-down >/dev/null; fi"
    on "$OLD" "rm -f /etc/nginx/sites-enabled/ketocare-moved.conf; \
        if ls /etc/nginx/sites-disabled-by-move/*.conf >/dev/null 2>&1; then mv /etc/nginx/sites-disabled-by-move/*.conf /etc/nginx/sites-enabled/; fi; \
        nginx -t >/dev/null 2>&1 && systemctl reload nginx"
    echo "сайты прежнего сервера включены"
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
        # Выкат из GitHub на прежний сервер больше не должен ничего запускать:
        # его `main` поднял бы там приложение и второго бота с тем же токеном.
        on "$OLD" "if [ -f /srv/ketocare-deploy.sh ]; then mv /srv/ketocare-deploy.sh /srv/ketocare-deploy.sh.disabled-by-move; fi"
        if [ "${OLD_MODE:-redirect}" = relay ]; then
            relay_old
        else
            redirect_old
        fi
        echo
        echo "Перенос выполнен. Прежний сервер остановлен в $STOPPED_AT и НЕ запускается сам;"
        echo "его адреса перенаправляют на новые. Дальше — по листу (docs/MIGRATION_2026-11.md)."
        echo "Откат: $0 rollback $OLD $NEW"
        ;;

    rollback)
        preflight
        say "новый сервер: обратно в режим ожидания"
        # Сначала глушится бот нового: два бота с одним токеном отбирают
        # сообщения друг у друга.
        on "$NEW" "touch /etc/ketocare/standby && $C stop bot worker"
        restore_old
        say "прежний сервер: запуск"
        on "$OLD" "$C up -d >/dev/null 2>&1"
        on "$OLD" "$C ps --format '{{.Service}} {{.State}}'" | sed 's/^/  /'
        echo
        echo "Откат выполнен: работает прежний сервер. Записи, сделанные на новом после"
        echo "переноса, остались на новом — перед повторным переносом решить, что с ними."
        ;;
esac
