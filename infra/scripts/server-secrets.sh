#!/usr/bin/env bash
# Служебные ключи сервера (ADR-0095): создаёт и хранит сам сервер.
#
#   server-secrets.sh init                 # создать недостающие ключи (root)
#   server-secrets.sh mirror ИМЯ...        # принять значения со стандартного входа (root)
#   server-secrets.sh render ФАЙЛ          # окружение приложения: настройки + ключи
#   server-secrets.sh names                # какие ключи есть — только имена
#
# Правило проекта: человек вводит настройки только в кабинете. Но пароль базы,
# ключ подписи сессий, ключ шифрования настроек кабинета и ключ связи бота с API
# нужны ДО того, как кабинет запустится, — в кабинет их не вынести. Поэтому их
# не вводит никто: сервер создаёт их при настройке и держит в файле, который
# читают только root и владелец выката. В GitHub и в репозитории их нет.
#
# Выкат приносит на сервер только несекретные настройки (адреса, часовой пояс);
# `render` дополняет их ключами. Имя, которое есть в файле ключей, из принесённых
# настроек выбрасывается: подменить ключ сервера снаружи нельзя.
#
# `mirror` нужен переносу (migrate-server.sh): часть значений боевого обязана
# остаться прежней — `SECRET_KEY` расшифровывает ключи ИИ, введённые в кабинете,
# к `BOT_TOKEN` привязаны семьи. Названные имена приводятся к пришедшему: есть на
# входе — заменяется, нет — УДАЛЯЕТСЯ. Второе не мелочь: на прежнем сервере не
# было отдельного ключа шифрования настроек (он выводился из `SECRET_KEY`), и
# оставь новый сервер свой — введённые в кабинете ключи ИИ перестали бы читаться.

set -euo pipefail

FILE="${KETOCARE_SECRETS:-/etc/ketocare/secrets.env}"
GROUP="${KETOCARE_SECRETS_GROUP:-ketocare}"

#: Что сервер создаёт сам. Больше ничего: токен Telegram-бота, ключи ИИ и прочие
#: интеграции вводятся в кабинете.
GENERATED="POSTGRES_PASSWORD SECRET_KEY BOT_API_TOKEN SETTINGS_ENCRYPTION_KEY MONITOR_TOKEN"

fail() { echo "$*" >&2; exit 1; }
names_in() { sed -n 's/^\([A-Z][A-Z0-9_]*\)=.*/\1/p' "$1"; }

generate() {
    case "$1" in
        # Ключ Fernet: 32 байта в urlsafe base64 (core.secret_box).
        SETTINGS_ENCRYPTION_KEY) openssl rand -base64 32 | tr '+/' '-_' ;;
        *) openssl rand -hex 32 ;;
    esac
}

save() {
    # Через временный файл рядом: читатель видит либо прежний файл, либо новый.
    local tmp="$FILE.next"
    ( umask 077; cat > "$tmp" )
    chown "root:$GROUP" "$tmp" 2>/dev/null || true
    chmod 640 "$tmp"
    mv "$tmp" "$FILE"
}

case "${1:-}" in
    init)
        install -d -m 0755 "$(dirname "$FILE")"
        [ -f "$FILE" ] || : | save
        have="$(names_in "$FILE")"
        {
            cat "$FILE"
            for name in $GENERATED; do
                printf '%s\n' "$have" | grep -qx "$name" && continue
                printf "%s='%s'\n" "$name" "$(generate "$name")"
            done
        } | save
        echo "ключи сервера: $(names_in "$FILE" | tr '\n' ' ')"
        ;;

    mirror)
        shift
        [ "$#" -gt 0 ] || fail "mirror: назовите имена"
        [ -f "$FILE" ] || fail "нет $FILE — сначала init"
        incoming="$(cat)"
        wanted="$(printf '%s\n' "$@")"
        {
            # Свои строки — кроме названных; названные — только с входа.
            while IFS= read -r line; do
                name="${line%%=*}"
                printf '%s\n' "$wanted" | grep -qx "$name" || printf '%s\n' "$line"
            done < "$FILE"
            # `if`, а не `&&`: последняя непринятая строка иначе стала бы кодом
            # возврата всего блока, и `pipefail` оборвал бы скрипт.
            while IFS= read -r line; do
                name="${line%%=*}"
                if printf '%s' "$name" | grep -qE '^[A-Z][A-Z0-9_]*$' \
                   && printf '%s\n' "$wanted" | grep -qx "$name"; then
                    printf '%s\n' "$line"
                fi
            done <<< "$incoming"
        } | save
        echo "ключи сервера: $(names_in "$FILE" | tr '\n' ' ')"
        ;;

    render)
        config="${2:-}"
        [ -f "$config" ] || fail "render: нет файла настроек"
        [ -f "$FILE" ] || fail "нет $FILE — сервер не настроен (bootstrap-server.sh)"
        own="$(names_in "$FILE")"
        while IFS= read -r line; do
            name="${line%%=*}"
            printf '%s\n' "$own" | grep -qx "$name" || printf '%s\n' "$line"
        done < "$config"
        echo "# Ключи сервера — $FILE; создаются сервером, не вводятся никем."
        cat "$FILE"
        ;;

    names)
        [ -f "$FILE" ] && names_in "$FILE"
        ;;

    *)
        sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
        exit 64
        ;;
esac
