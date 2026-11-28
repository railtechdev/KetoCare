#!/usr/bin/env bash
# Промежуточная схема на время, пока новые имена не открываются (ADR-0095).
#
#   interim-relay.sh new-up   <открытый ключ туннеля>   # на НОВОМ сервере
#   interim-relay.sh new-down                           # на новом: снять
#   interim-relay.sh old-up   <новый-IP> <имя-прежнее> <имя-новое>   # на ПРЕЖНЕМ
#   interim-relay.sh old-down                           # на прежнем: снять
#   interim-relay.sh old-key                            # на прежнем: ключ туннеля
#
# Данные и приложение уже на новом сервере, а люди ходят по прежним адресам:
# прежний сервер принимает их своим сертификатом и пересылает запросы новому.
#
# Канал — SSH-туннель, а не HTTPS между серверами:
#   • у хостинга нового сервера снаружи открыт только порт 22;
#   • SSH шифрует и проверяет обе стороны: ключ сервера закреплён, вход — по
#     отдельному ключу, который умеет только одно — пробросить порт 80 нового
#     сервера (`restrict,port-forwarding,permitopen`), без оболочки;
#   • туннель держит systemd и поднимает сам при обрыве.
#
# Адрес клиента доходит до приложения настоящим (realip): иначе ограничение
# частоты на входе считало бы всех пользователей одним адресом и закрыло бы
# вход всем после пяти попыток. Заголовку верим только с 127.0.0.1 — оттуда
# приходит туннель.

set -euo pipefail

INTERIM=/etc/ketocare/interim
LOCAL_PORT=18080
OWNER=ketocare
fail() { echo "$*" >&2; exit 1; }

case "${1:-}" in
    new-up)
        pub="${2:-}"
        printf '%s' "$pub" | grep -qE '^ssh-ed25519 [A-Za-z0-9+/=]+' || fail "нужен открытый ключ туннеля"
        cat > /etc/nginx/conf.d/ketocare-interim-realip.conf <<'EOF'
# ВРЕМЕННО (interim-relay.sh): запросы приходят SSH-туннелем с 127.0.0.1,
# адрес клиента — в заголовке, который ставит прежний сервер.
set_real_ip_from 127.0.0.1;
real_ip_header X-Forwarded-For;
EOF
        nginx -t 2>&1 | tail -1
        systemctl reload nginx
        keys="/home/$OWNER/.ssh/authorized_keys"
        body="$(printf '%s' "$pub" | awk '{print $2}')"
        sed -i '/ketocare-interim-tunnel$/d' "$keys"
        echo "restrict,port-forwarding,permitopen=\"127.0.0.1:80\",command=\"/bin/false\" $(printf '%s' "$pub" | awk '{print $1, $2}') ketocare-interim-tunnel" >> "$keys"
        grep -c "$body" "$keys" >/dev/null
        echo "туннель разрешён: только проброс 127.0.0.1:80"
        ;;

    new-down)
        rm -f /etc/nginx/conf.d/ketocare-interim-realip.conf
        nginx -t 2>&1 | tail -1
        systemctl reload nginx
        sed -i '/ketocare-interim-tunnel$/d' "/home/$OWNER/.ssh/authorized_keys"
        echo "туннель запрещён, realip снят"
        ;;

    old-key)
        install -d -m 0700 "$INTERIM"
        [ -f "$INTERIM/tunnel_key" ] || ssh-keygen -q -t ed25519 -N "" -C ketocare-interim-tunnel -f "$INTERIM/tunnel_key"
        cat "$INTERIM/tunnel_key.pub"
        ;;

    old-up)
        new_ip="${2:-}"; old_name="${3:-}"; new_name="${4:-}"
        printf '%s' "$new_ip" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || fail "нужен IP нового сервера"
        [ -n "$old_name" ] && [ -n "$new_name" ] || fail "нужны прежнее и новое имя"
        [ -f "$INTERIM/tunnel_key" ] || fail "нет ключа туннеля — сначала old-key"
        [ -s "$INTERIM/known_hosts" ] || fail "нет закреплённого ключа нового сервера $INTERIM/known_hosts"
        cert="/etc/letsencrypt/live/$old_name"
        [ -f "$cert/fullchain.pem" ] || fail "нет сертификата $cert"

        cat > /etc/systemd/system/ketocare-tunnel.service <<EOF
[Unit]
Description=KetoCare: SSH-туннель к новому серверу (временно, ADR-0095)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/ssh -N -i $INTERIM/tunnel_key -o IdentitiesOnly=yes \\
    -o UserKnownHostsFile=$INTERIM/known_hosts -o StrictHostKeyChecking=yes \\
    -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \\
    -L 127.0.0.1:$LOCAL_PORT:127.0.0.1:80 $OWNER@$new_ip
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
        systemctl daemon-reload
        systemctl enable --now ketocare-tunnel.service >/dev/null 2>&1
        for _ in $(seq 1 20); do
            curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$LOCAL_PORT/" && break
            sleep 1
        done
        curl -s -o /dev/null --max-time 5 "http://127.0.0.1:$LOCAL_PORT/" || fail "туннель не поднялся (journalctl -u ketocare-tunnel)"

        conf=/etc/nginx/sites-available/ketocare-relay.conf
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
    server_name ${prefix}${old_name};
    ssl_certificate $cert/fullchain.pem;
    ssl_certificate_key $cert/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:$LOCAL_PORT;
        proxy_set_header Host ${prefix}${new_name};
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}
server {
    listen 80;
    listen [::]:80;
    server_name ${prefix}${old_name};
    return 301 https://\$host\$request_uri;
}
EOF
            done
        } > "$conf"
        mkdir -p /etc/nginx/sites-disabled-by-move
        for site in ketocare-landing ketocare-app ketocare-miniapp ketocare-moved; do
            if [ -L "/etc/nginx/sites-enabled/$site.conf" ]; then
                mv "/etc/nginx/sites-enabled/$site.conf" /etc/nginx/sites-disabled-by-move/
            fi
        done
        ln -sf "$conf" /etc/nginx/sites-enabled/ketocare-relay.conf
        if ! nginx -t >/dev/null 2>&1; then
            nginx -t 2>&1 | tail -3 >&2
            rm -f /etc/nginx/sites-enabled/ketocare-relay.conf
            for f in /etc/nginx/sites-disabled-by-move/*.conf; do
                if [ -e "$f" ]; then mv "$f" /etc/nginx/sites-enabled/; fi
            done
            fail "nginx не принял пересылку — прежние сайты возвращены"
        fi
        systemctl reload nginx
        echo "прежние адреса пересылаются на $new_ip через туннель"
        ;;

    old-down)
        rm -f /etc/nginx/sites-enabled/ketocare-relay.conf
        for f in /etc/nginx/sites-disabled-by-move/*.conf; do
            if [ -e "$f" ]; then mv "$f" /etc/nginx/sites-enabled/; fi
        done
        nginx -t 2>&1 | tail -1
        systemctl reload nginx
        systemctl disable --now ketocare-tunnel.service >/dev/null 2>&1 || true
        echo "пересылка снята, прежние сайты включены, туннель остановлен"
        ;;

    *)
        sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
        exit 64
        ;;
esac
