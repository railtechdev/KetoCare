#!/usr/bin/env bash
# Первичная настройка сервера под KetoCare. Запускается ОТ ROOT:
#
#   scp infra/scripts/bootstrap-server.sh root@<адрес>:/tmp/
#   ssh root@<адрес> "ENVIRONMENT=demo BASE_DOMAIN=demo.ketocare.uz bash /tmp/bootstrap-server.sh"
#
# Серверов два (ADR-0095), и скрипт обязан знать, какой он настраивает:
#
#   ENVIRONMENT    demo | production — метка сервера: чужое окружение выкат сюда
#                  не положит (remote-deploy.sh);
#   BASE_DOMAIN    имя посадочной; кабинет — app.<имя>, Mini App — tma.<имя>;
#   LEGACY_DOMAIN  прежнее имя посадочной (необязательно): три прежних имени
#                  будут перенаправлять на новые — по ним закладки врачей и
#                  кнопки в старых сообщениях бота;
#   STANDBY=1      режим ожидания: бот и воркер не запускаются, пока сюда не
#                  перенесены данные (docs/MIGRATION_2026-11.md);
#   DEPLOY_PUBKEY  открытая часть ключа выката — встанет в authorized_keys
#                  с ограничением одной командой;
#   REPO_REF       ветка или коммит, из которого берутся конфигурации nginx и
#                  точка входа выката (на свежем клоне — main; на работающем
#                  сервере рабочее дерево без этой переменной не трогается).
#
# Повторный запуск безопасен: каждый шаг сначала проверяет, не сделан ли он уже.
# Дальше сервер обновляется только выкатом (docs/DEPLOY.md).
#
# Чего скрипт НЕ делает намеренно:
#   • не создаёт .env — окружение приходит из секретов GitHub при каждом деплое;
#   • не запускает первый деплой — он идёт через Actions, чтобы пароль базы,
#     который postgres принимает только при инициализации пустого тома, сразу
#     совпал с секретом;
#   • не трогает конфиги nginx, если они уже есть: certbot дописывает в них
#     блоки TLS ПРЯМО В ЭТИ ФАЙЛЫ, и повторное копирование из репозитория
#     стёрло бы сертификаты вместе с редиректом на https;
#   • не снимает режим ожидания: это шаг переноса, а не настройки.

set -euo pipefail

ENVIRONMENT="${ENVIRONMENT:-}"
BASE_DOMAIN="${BASE_DOMAIN:-}"
LEGACY_DOMAIN="${LEGACY_DOMAIN:-}"
STANDBY="${STANDBY:-}"
DEPLOY_PUBKEY="${DEPLOY_PUBKEY:-}"
OWNER="${OWNER:-ketocare}"
# По https: репозиторий открытый, и ключ доступа к GitHub серверу не нужен.
# Закроют репозиторий — здесь понадобится deploy key и адрес git@github.com:….
REPO_URL="${REPO_URL:-https://github.com/railtechdev/KetoCare.git}"
REPO_REF="${REPO_REF:-}"
REPO=/srv/ketocare
# Точка входа выката — ВНЕ рабочего дерева и в каталоге ВЛАДЕЛЬЦА (см. шаг ниже).
ENTRY_DIR=/srv/ketocare-entry
ENTRYPOINT="$ENTRY_DIR/deploy.sh"
# Имя, зашитое в конфигурации nginx репозитория; при установке заменяется.
TEMPLATE_DOMAIN="ketocare.railtech.uz"

step() { echo; echo "### $*"; }
have() { command -v "$1" >/dev/null 2>&1; }
fail() { echo "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Запускать от root"
case "$ENVIRONMENT" in
    demo|production) ;;
    *) fail "Задайте ENVIRONMENT=demo или ENVIRONMENT=production" ;;
esac
# Имя уходит в sed и в конфигурацию nginx: только то, из чего состоят имена.
printf '%s' "$BASE_DOMAIN" | grep -qE '^[a-z0-9]([a-z0-9.-]{1,80})[a-z0-9]$' \
    || fail "Задайте BASE_DOMAIN, например ketocare.uz"
if [ -n "$LEGACY_DOMAIN" ]; then
    printf '%s' "$LEGACY_DOMAIN" | grep -qE '^[a-z0-9]([a-z0-9.-]{1,80})[a-z0-9]$' \
        || fail "LEGACY_DOMAIN — не имя"
fi

DOMAIN_LANDING="$BASE_DOMAIN"
DOMAIN_APP="app.$BASE_DOMAIN"
DOMAIN_MINIAPP="tma.$BASE_DOMAIN"

export DEBIAN_FRONTEND=noninteractive

step "процессор"
# Колёса numpy 2.x собраны под x86-64-v2 (ADR-0014). Не отказ: стек пока
# закреплён на версиях, которые работают и без него, — но знать надо сейчас.
if [ "$(grep -o -E 'sse4_2|popcnt' /proc/cpuinfo | sort -u | wc -l)" -eq 2 ]; then
    echo "x86-64-v2: да"
else
    echo "x86-64-v2: НЕТ (sse4_2/popcnt не видны) — ограничения ADR-0014 остаются"
fi

step "метка окружения: $ENVIRONMENT"
install -d -m 0755 /etc/ketocare
if [ -f /etc/ketocare/environment ] \
   && [ "$(tr -d '[:space:]' < /etc/ketocare/environment)" != "$ENVIRONMENT" ]; then
    fail "Сервер уже размечен как «$(cat /etc/ketocare/environment)» — менять окружение на месте нельзя"
fi
echo "$ENVIRONMENT" > /etc/ketocare/environment
if [ "$STANDBY" = "1" ]; then
    touch /etc/ketocare/standby
fi
[ -f /etc/ketocare/standby ] && echo "режим ожидания: бот и воркер не запускаются"

step "пользователь $OWNER"
if id "$OWNER" >/dev/null 2>&1; then
    echo "уже есть"
else
    # uid 1000 обязателен: deploy.sh монтирует apps/api в контейнер и пишет туда
    # openapi.json процессом, который внутри образа идёт под uid 1000.
    adduser --disabled-password --gecos "" --uid 1000 "$OWNER"
    usermod -aG sudo "$OWNER"
fi

step "swap"
if swapon --show | grep -q .; then
    echo "уже есть: $(swapon --show --noheadings --raw | head -1)"
else
    # Сборка фронта при выкате берёт до 1,5 ГБ рядом с работающей системой.
    fallocate -l 2G /swapfile && chmod 600 /swapfile
    mkswap /swapfile >/dev/null && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "часовой пояс"
# Приложение живёт в Asia/Tashkent, и cron бэкапов задаётся в местных часах.
# На UTC-хосте «0 3» отработало бы в 08:00 по Ташкенту — в рабочее время.
timedatectl set-timezone Asia/Tashkent
echo "$(timedatectl show -p Timezone --value)"

step "файрвол"
ufw allow OpenSSH >/dev/null
ufw allow 80,443/tcp >/dev/null
ufw --force enable >/dev/null   # --force: без него ufw ждёт ответа про разрыв ssh
ufw status | head -5

step "базовые пакеты"
apt-get update -qq
# age — шифрование резервных копий: без него backup.sh отказывается работать.
apt-get install -y -qq nginx python3-certbot-nginx rsync git curl ca-certificates \
    gnupg unattended-upgrades age >/dev/null
echo "nginx $(nginx -v 2>&1 | sed 's|.*/||')"

step "docker"
if have docker; then
    echo "уже есть: $(docker --version)"
else
    # Из официального репозитория, а не из apt Ubuntu: там нет compose-plugin.
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin >/dev/null
fi
usermod -aG docker "$OWNER"

step "node 22 + corepack"
if have node; then
    echo "уже есть: $(node --version)"
else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs >/dev/null
fi
corepack enable >/dev/null 2>&1 || true

step "каталоги"
WEB_ROOTS="/var/www/ketocare-landing /var/www/ketocare-app /var/www/ketocare-miniapp"
# shellcheck disable=SC2086
mkdir -p "$REPO" $WEB_ROOTS /srv/backups
# Владелец — тот, от кого идёт выкат: в каталог, созданный root, rsync писать
# не сможет, и выкат упадёт целиком (так и вышло с каталогом Mini App).
# shellcheck disable=SC2086
chown "$OWNER:$OWNER" "$REPO" $WEB_ROOTS /srv/backups
# 700 у бэкапов: там дампы с клиническими данными и архивы удалённых пациентов.
chmod 700 /srv/backups
chmod 750 "$REPO"
ls -ld /srv/backups "$REPO" | sed 's/^/  /'

step "репозиторий"
FRESH_CLONE=""
if [ -d "$REPO/.git" ]; then
    echo "уже склонирован: $(sudo -u "$OWNER" git -C "$REPO" log --oneline -1)"
else
    sudo -u "$OWNER" git clone --quiet "$REPO_URL" "$REPO"
    FRESH_CLONE=1
fi
# Рабочее дерево двигается только на свежем клоне или по прямой просьбе: на
# работающем сервере его ведёт выкат, и повторный запуск настройки (например,
# за сертификатом) не вправе сменить код под ним.
if [ -n "$REPO_REF" ] || [ -n "$FRESH_CLONE" ]; then
    REF="${REPO_REF:-main}"
    printf '%s' "$REF" | grep -qE '^[A-Za-z0-9._/-]{1,120}$' || fail "REPO_REF — не имя ветки и не коммит"
    sudo -u "$OWNER" git -C "$REPO" fetch --quiet origin
    # Отсоединённый HEAD, как после выката.
    if sudo -u "$OWNER" git -C "$REPO" rev-parse --verify --quiet "origin/$REF" >/dev/null; then
        sudo -u "$OWNER" git -C "$REPO" checkout --quiet --detach --force "origin/$REF"
    else
        sudo -u "$OWNER" git -C "$REPO" checkout --quiet --detach --force "$REF"
    fi
    echo "код: $(sudo -u "$OWNER" git -C "$REPO" log --oneline -1)"
fi

step "ключи сервера"
# Пароль базы, ключ подписи сессий, ключ шифрования настроек и ключ связи бота
# с API создаёт сам сервер: они нужны раньше, чем запустится кабинет, поэтому
# их не вводит никто, и в GitHub их нет (ADR-0095). Повторный запуск уже
# созданные не трогает — иначе сменился бы пароль у работающей базы.
KETOCARE_SECRETS_GROUP="$OWNER" bash "$REPO/infra/scripts/server-secrets.sh" init

step "nginx: заголовки безопасности"
# Сайты подключают их строкой `include` в каждом location. Без этих файлов
# nginx не проходит проверку вовсе: «open() …/ketocare-security-headers.conf failed».
install -d -m 0755 /etc/nginx/snippets
install -m 0644 "$REPO/infra/nginx/security-headers.conf" /etc/nginx/snippets/ketocare-security-headers.conf
for policy in app miniapp landing; do
    install -m 0644 "$REPO/infra/nginx/csp-$policy.conf" "/etc/nginx/snippets/ketocare-csp-$policy.conf"
done
# Без этого nginx не стартует ВООБЩЕ: имя app.* не помещается в корзину
# хеш-таблицы имён по умолчанию (32 байта).
install -m 0644 "$REPO/infra/nginx/server-names-hash.conf" /etc/nginx/conf.d/

step "nginx: сайты $DOMAIN_LANDING, $DOMAIN_APP, $DOMAIN_MINIAPP"
for site in ketocare-landing ketocare-app ketocare-miniapp; do
    if [ -f "/etc/nginx/sites-available/$site.conf" ]; then
        echo "  $site.conf уже есть — не трогаем (в нём блоки TLS от certbot)"
    else
        # В репозитории конфигурации написаны на имя первого стенда; имена этого
        # сервера получаются заменой: app.<имя> и tma.<имя> — те же приставки.
        sed "s/${TEMPLATE_DOMAIN//./\\.}/$BASE_DOMAIN/g" "$REPO/infra/nginx/$site.conf" \
            > "/etc/nginx/sites-available/$site.conf"
        chmod 0644 "/etc/nginx/sites-available/$site.conf"
    fi
    ln -sf "/etc/nginx/sites-available/$site.conf" "/etc/nginx/sites-enabled/$site.conf"
done

# `www.<имя>` — так адрес набирают руками. Только перенаправление, и только если
# запись в DNS есть: имя без записи не дало бы выпустить сертификат на остальные.
WWW_DOMAIN=""
if getent hosts "www.$BASE_DOMAIN" >/dev/null 2>&1; then
    WWW_DOMAIN="www.$BASE_DOMAIN"
    step "nginx: $WWW_DOMAIN → $BASE_DOMAIN"
    if [ -f /etc/nginx/sites-available/ketocare-www.conf ]; then
        echo "  ketocare-www.conf уже есть — не трогаем"
    else
        printf 'server {\n    listen 80;\n    listen [::]:80;\n    server_name %s;\n    return 301 https://%s$request_uri;\n}\n' \
            "$WWW_DOMAIN" "$BASE_DOMAIN" > /etc/nginx/sites-available/ketocare-www.conf
        chmod 0644 /etc/nginx/sites-available/ketocare-www.conf
    fi
    ln -sf /etc/nginx/sites-available/ketocare-www.conf /etc/nginx/sites-enabled/ketocare-www.conf
fi

if [ -n "$LEGACY_DOMAIN" ]; then
    step "nginx: прежние имена → новые"
    if [ -f /etc/nginx/sites-available/ketocare-legacy.conf ]; then
        echo "  ketocare-legacy.conf уже есть — не трогаем"
    else
        # Только перенаправление: по прежним именам лежат закладки врачей,
        # ссылки на распечатках и кнопки в старых сообщениях бота. Сертификат на
        # эти имена выпускается после того, как их DNS укажет сюда
        # (docs/MIGRATION_2026-11.md), — до тех пор блоки отвечают только на 80.
        {
            for prefix in "" "app." "tma."; do
                cat <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${prefix}${LEGACY_DOMAIN};
    return 301 https://${prefix}${BASE_DOMAIN}\$request_uri;
}
EOF
            done
        } > /etc/nginx/sites-available/ketocare-legacy.conf
        chmod 0644 /etc/nginx/sites-available/ketocare-legacy.conf
    fi
    ln -sf /etc/nginx/sites-available/ketocare-legacy.conf /etc/nginx/sites-enabled/ketocare-legacy.conf
fi

# Дефолтный сайт перехватывает запросы к именам, которых ещё нет, и проверка
# certbot уходит не туда.
rm -f /etc/nginx/sites-enabled/default
# Заглушки: 80-й порт обязан отвечать 200 ДО выпуска сертификатов.
for root in $WEB_ROOTS; do
    if [ ! -f "$root/index.html" ]; then
        echo "KetoCare: разворачивается" > "$root/index.html"
        chown "$OWNER:$OWNER" "$root/index.html"
    fi
done
nginx -t 2>&1 | tail -1
systemctl reload nginx

step "TLS"
if [ -d "/etc/letsencrypt/live/$DOMAIN_LANDING" ]; then
    certbot certificates 2>/dev/null | grep -E "Certificate Name|Domains|Expiry" | sed 's/^/  /'
else
    # Порядок обязателен: certbot проверяет доступность имён СНАРУЖИ, поэтому
    # DNS уже должен указывать сюда, а nginx — отвечать на 80. Отказ не
    # останавливает настройку: DNS заводит человек, и запись могла ещё не
    # разойтись — шаг повторяется тем же запуском скрипта.
    #
    # `--redirect` обязателен: refresh-токен живёт в httpOnly-cookie и по
    # чистому HTTP утекает.
    certbot --nginx -d "$DOMAIN_LANDING" -d "$DOMAIN_APP" -d "$DOMAIN_MINIAPP" \
        ${WWW_DOMAIN:+-d "$WWW_DOMAIN"} \
        --redirect --agree-tos --register-unsafely-without-email --non-interactive \
        || echo "СЕРТИФИКАТ НЕ ВЫПУЩЕН: проверьте A-записи трёх имён и запустите скрипт ещё раз" >&2
fi

if [ "$ENVIRONMENT" = "production" ]; then
    step "бэкапы по расписанию"
    CRON="0 3 * * * $REPO/infra/scripts/backup.sh >> /srv/backups/backup.log 2>&1"
    if sudo -u "$OWNER" crontab -l 2>/dev/null | grep -qF "backup.sh"; then
        echo "уже настроены"
    else
        { sudo -u "$OWNER" crontab -l 2>/dev/null || true; echo "$CRON"; } | sudo -u "$OWNER" crontab -
        echo "добавлено: $CRON"
    fi
else
    # На тестовом — демо-данные: их пересобирает сид, копировать нечего, а без
    # ключа шифрования скрипт каждую ночь писал бы в журнал отказ.
    echo
    echo "### бэкапы: на тестовом не ставятся"
fi

step "точка входа выката"
# Вне рабочего дерева намеренно: скрипт делает `git checkout --force`, и лежи
# исполняемая копия внутри репозитория, checkout переписывал бы файл, который
# bash в этот момент выполняет. Каталог — владельца выката: копия обновляет
# себя сама (временный файл рядом и переименование), а в корне /srv,
# принадлежащем root, выкат создать файл не может — «Permission denied».
install -d -m 0755 -o "$OWNER" -g "$OWNER" "$ENTRY_DIR"
install -m 0755 -o "$OWNER" -g "$OWNER" \
    "$REPO/infra/scripts/remote-deploy.sh" "$ENTRYPOINT"
ls -l "$ENTRYPOINT"

if [ -n "$DEPLOY_PUBKEY" ]; then
    step "ключ выката"
    # Ключ умеет ровно одно — запустить точку входа. Без ограничения утечка
    # секрета DEPLOY_SSH_KEY означала бы полный доступ к машине: владелец
    # состоит в группе docker, а docker — это root по построению.
    printf '%s' "$DEPLOY_PUBKEY" | grep -qE '^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+( [^"]*)?$' \
        || fail "DEPLOY_PUBKEY — не открытый ключ ssh"
    KEYS="/home/$OWNER/.ssh/authorized_keys"
    install -d -m 0700 -o "$OWNER" -g "$OWNER" "/home/$OWNER/.ssh"
    touch "$KEYS" && chown "$OWNER:$OWNER" "$KEYS" && chmod 600 "$KEYS"
    KEY_BODY="$(printf '%s' "$DEPLOY_PUBKEY" | awk '{print $2}')"
    if grep -qF "$KEY_BODY" "$KEYS"; then
        echo "уже записан"
    else
        echo "restrict,command=\"$ENTRYPOINT\" $DEPLOY_PUBKEY" >> "$KEYS"
        echo "записан с ограничением: command=\"$ENTRYPOINT\""
    fi
fi

echo
echo "Готово: $ENVIRONMENT, $DOMAIN_LANDING."
echo "  1. Секреты и переменные окружения «$ENVIRONMENT» в GitHub (docs/DEPLOY.md):"
echo "     DEPLOY_HOST, DEPLOY_USER=$OWNER, DEPLOY_KNOWN_HOSTS, DEPLOY_SSH_KEY и секреты приложения."
echo "  2. Actions → Deploy → Run workflow, окружение «$ENVIRONMENT» — первый выкат."
[ -f /etc/ketocare/standby ] && echo "  3. Режим ожидания снимает перенос данных: docs/MIGRATION_2026-11.md."
exit 0
