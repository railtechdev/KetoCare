#!/usr/bin/env bash
# Выпустить сертификат, как только имена сервера начнут указывать на него.
#
#   cert-when-dns-ready.sh ИМЯ...        # первое имя — имя сертификата
#
# Ставится в cron root (bootstrap-server.sh), когда при настройке сервера DNS
# ещё не разошёлся: регистратор меняет записи до суток, и ждать человека, чтобы
# повторить настройку, незачем. Каждый запуск проверяет, указывает ли КАЖДОЕ
# имя на этот сервер, и только тогда зовёт certbot: попытки на неготовом DNS
# расходуют предел Let's Encrypt (пять неудач в час на имя).
#
# Сертификат выпущен — скрипт убирает свою строку из cron и больше не
# запускается. Журнал — /var/log/ketocare-cert.log.

set -euo pipefail

[ "$#" -gt 0 ] || { echo "назовите имена" >&2; exit 64; }
PRIMARY="$1"
CRON_FILE=/etc/cron.d/ketocare-cert
LOG=/var/log/ketocare-cert.log
log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

if [ -d "/etc/letsencrypt/live/$PRIMARY" ]; then
    rm -f "$CRON_FILE"
    exit 0
fi

# Адрес, под которым этот сервер виден снаружи.
OWN="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
[ -n "$OWN" ] || OWN="$(hostname -I | awk '{print $1}')"

for name in "$@"; do
    # Публичный резолвер, а не системный: кеш провайдера мог запомнить отказ.
    seen="$(dig +short @8.8.8.8 "$name" A | grep -E '^[0-9.]+$' | tail -1 || true)"
    if [ "$seen" != "$OWN" ]; then
        log "ждём DNS: $name → «${seen:-нет записи}», нужен $OWN"
        exit 0
    fi
done

args=()
for name in "$@"; do args+=(-d "$name"); done
if certbot --nginx "${args[@]}" --redirect --agree-tos \
        --register-unsafely-without-email --non-interactive >> "$LOG" 2>&1; then
    log "сертификат выпущен: $*"
    rm -f "$CRON_FILE"
else
    log "certbot не выпустил сертификат — следующая попытка через 15 минут"
fi
