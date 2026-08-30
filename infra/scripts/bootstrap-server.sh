#!/usr/bin/env bash
# Первичная настройка VPS под пред-прод. Запускается ОТ ROOT, один раз:
#
#   scp infra/scripts/bootstrap-server.sh root@<адрес>:/tmp/
#   ssh root@<адрес> "bash /tmp/bootstrap-server.sh"
#
# Повторный запуск безопасен: каждый шаг сначала проверяет, не сделан ли он уже.
# Дальше стенд обновляется только автодеплоем (docs/DEPLOY.md) — на сервер после
# этого заходить незачем.
#
# Чего скрипт НЕ делает намеренно:
#   • не создаёт .env — окружение приходит из секретов GitHub при каждом деплое;
#   • не запускает первый деплой — он идёт через Actions, чтобы пароль базы,
#     который postgres принимает только при инициализации пустого тома, сразу
#     совпал с секретом;
#   • не трогает конфиги nginx, если они уже есть: certbot дописывает в них
#     блоки TLS ПРЯМО В ЭТИ ФАЙЛЫ, и повторное копирование из репозитория
#     стёрло бы сертификаты вместе с редиректом на https.

set -euo pipefail

DOMAIN_LANDING="${DOMAIN_LANDING:-ketocare.railtech.uz}"
DOMAIN_APP="${DOMAIN_APP:-app.ketocare.railtech.uz}"
OWNER="${OWNER:-ketocare}"
REPO_URL="${REPO_URL:-git@github.com:railtechdev/KetoCare.git}"
REPO=/srv/ketocare
# Точка входа автодеплоя — ВНЕ рабочего дерева (см. шаг ниже).
ENTRYPOINT=/srv/ketocare-deploy.sh

step() { echo; echo "### $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

[ "$(id -u)" -eq 0 ] || { echo "Запускать от root" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive

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
    # Без swap сборка фронта и weasyprint упираются в OOM на 2 ГБ RAM.
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
apt-get install -y -qq nginx python3-certbot-nginx rsync git curl ca-certificates \
    gnupg unattended-upgrades >/dev/null
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
mkdir -p "$REPO" /var/www/ketocare-landing /var/www/ketocare-app /srv/backups
chown "$OWNER:$OWNER" "$REPO" /var/www/ketocare-landing /var/www/ketocare-app /srv/backups
# 700 у бэкапов: там дампы с клиническими данными и архивы удалённых пациентов.
chmod 700 /srv/backups
chmod 750 "$REPO"
ls -ld /srv/backups "$REPO" | sed 's/^/  /'

step "репозиторий"
if [ -d "$REPO/.git" ]; then
    echo "уже склонирован: $(sudo -u "$OWNER" git -C "$REPO" log --oneline -1)"
else
    # Ключ доступа к GitHub (deploy key) должен уже лежать у $OWNER в ~/.ssh.
    sudo -u "$OWNER" git clone --quiet "$REPO_URL" "$REPO"
fi

step "nginx: сайты"
install -m 0644 "$REPO/infra/nginx/server-names-hash.conf" /etc/nginx/conf.d/
# Без этого nginx не стартует ВООБЩЕ: имя app.* не помещается в корзину
# хеш-таблицы имён по умолчанию (32 байта).
for site in ketocare-landing ketocare-app; do
    if [ -f "/etc/nginx/sites-available/$site.conf" ]; then
        echo "  $site.conf уже есть — не трогаем (в нём блоки TLS от certbot)"
    else
        install -m 0644 "$REPO/infra/nginx/$site.conf" /etc/nginx/sites-available/
    fi
    ln -sf "/etc/nginx/sites-available/$site.conf" "/etc/nginx/sites-enabled/$site.conf"
done
# Дефолтный сайт перехватывает запросы к именам, которых ещё нет, и проверка
# certbot уходит не туда.
rm -f /etc/nginx/sites-enabled/default
# Заглушки: 80-й порт обязан отвечать 200 ДО выпуска сертификатов.
for root in /var/www/ketocare-landing /var/www/ketocare-app; do
    [ -f "$root/index.html" ] || echo "KetoCare: разворачивается" > "$root/index.html"
done
nginx -t 2>&1 | tail -1
systemctl reload nginx

step "TLS"
if [ -d "/etc/letsencrypt/live/$DOMAIN_LANDING" ]; then
    certbot certificates 2>/dev/null | grep -E "Certificate Name|Expiry" | sed 's/^/  /'
else
    # Порядок обязателен: certbot проверяет доступность имён СНАРУЖИ, поэтому
    # DNS уже должен указывать сюда, а nginx — отвечать на 80.
    certbot --nginx -d "$DOMAIN_LANDING" -d "$DOMAIN_APP" \
        --redirect --agree-tos --register-unsafely-without-email --non-interactive
fi

step "бэкапы по расписанию"
CRON="0 3 * * * $REPO/infra/scripts/backup.sh >> /srv/backups/backup.log 2>&1"
if sudo -u "$OWNER" crontab -l 2>/dev/null | grep -qF "backup.sh"; then
    echo "уже настроены"
else
    { sudo -u "$OWNER" crontab -l 2>/dev/null || true; echo "$CRON"; } | sudo -u "$OWNER" crontab -
    echo "добавлено: $CRON"
fi

step "точка входа автодеплоя"
# Вне рабочего дерева намеренно: скрипт делает `git checkout --force`, и лежи
# исполняемая копия внутри репозитория, checkout переписывал бы файл, который
# bash в этот момент выполняет. Дальше копия обновляет себя сама, последним
# шагом успешного выката.
install -m 0755 -o "$OWNER" -g "$OWNER" \
    "$REPO/infra/scripts/remote-deploy.sh" "$ENTRYPOINT"
ls -l "$ENTRYPOINT"

echo
echo "Готово. Дальше — БЕЗ входа на сервер:"
echo "  1. Ключ автодеплоя: открытую часть в ~$OWNER/.ssh/authorized_keys строкой"
echo "     restrict,command=\"$ENTRYPOINT\" ssh-ed25519 …"
echo "     закрытую — в секрет DEPLOY_SSH_KEY репозитория."
echo "  2. Actions → Deploy → Run workflow — первый выкат."
echo "  3. Первый администратор: секреты ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME —"
echo "     учётка появится сама при выкате (docs/DEPLOY.md)."
