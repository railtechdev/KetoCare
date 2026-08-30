#!/usr/bin/env bash
# Единственное, что может выполнить ключ автодеплоя (.github/workflows/deploy.yml).
#
# В authorized_keys пользователя ketocare ключ записан с ограничением:
#
#   restrict,command="/srv/ketocare/infra/scripts/remote-deploy.sh" ssh-ed25519 AAAA...
#
# Без него утечка секрета DEPLOY_SSH_KEY означала бы не «выложить статику», а
# полный доступ к машине: ketocare состоит в группах sudo и docker, а docker —
# это root по построению. Здесь же ключ умеет ровно одно — выкатить коммит.
#
# Протокол вызова:
#   stdin                  — содержимое .env (собрано из секретов в Actions);
#   SSH_ORIGINAL_COMMAND   — коммит или ветка, которую надо выкатить.
#
# .env приходит именно потоком, а не аргументом: аргументы видны в `ps aux`
# любому локальному пользователю, а там SECRET_KEY и пароль базы.

set -euo pipefail

REPO=/srv/ketocare
cd "$REPO"

# Обрыв ssh не должен останавливать деплой на полпути. Проверено вживую: связь
# рвалась на 20-минутной сборке образов, а бросить её между `alembic upgrade` и
# `compose up` хуже, чем довести до конца — база уже на новой схеме, а
# приложение осталось бы на старой.
trap '' HUP

# Замок на весь деплой. `concurrency` в GitHub Actions защищает только от двух
# прогонов Actions; ручной запуск, повторный вызов после обрыва связи или другой
# оператор проходят мимо него, а два `alembic upgrade` на одной базе — это уже
# не «неудобно».
exec 9>"$REPO/.deploy.lock"
if ! flock -n 9; then
    echo "Деплой уже идёт (замок $REPO/.deploy.lock) — отказано" >&2
    exit 75
fi

REF="${SSH_ORIGINAL_COMMAND:-main}"

# Проверка до всего: строка приходит снаружи и попадает в git. Разрешены только
# hex-хеш и имя ветки из безопасного набора — иначе `$(...)` в имени ветки (git
# такое имя принимает) выполнился бы здесь.
if ! printf '%s' "$REF" | grep -qE '^[A-Za-z0-9._/-]{1,120}$'; then
    echo "Недопустимая ссылка на коммит: отказано" >&2
    exit 64
fi

echo "→ окружение"
# umask до создания файла, а не chmod после: между созданием и chmod файл с
# секретами был бы читаем всем.
umask 077
cat > "$REPO/.env.next"
if [ ! -s "$REPO/.env.next" ]; then
    echo "Пустой файл окружения — отказано, рабочий .env не тронут" >&2
    rm -f "$REPO/.env.next"
    exit 65
fi
mv "$REPO/.env.next" "$REPO/.env"

echo "→ код: $REF"
git fetch --quiet origin
# Выкатывается ровно тот коммит, что передан, а не вершина ветки на этот момент.
git checkout --quiet --detach "$REF"
git log --oneline -1

echo "→ деплой"
infra/scripts/deploy.sh

echo "→ проверка живости"
# Изнутри сервера: снаружи /health не проксируется (nginx отдаёт только /api/),
# и запрос попал бы в SPA, получив 200 от index.html при мёртвом API.
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 5 http://127.0.0.1:8001/health >/dev/null 2>&1; then
        echo "API отвечает (попытка $attempt)"
        exit 0
    fi
    sleep 3
done

echo "API не ответил за 30 секунд после деплоя" >&2
# Только состояние сервисов — без логов: журнал прогона публичного репозитория
# читает кто угодно, а в логах API пути с идентификаторами пациентов.
docker compose --env-file .env -f infra/docker-compose.prod.yml ps \
    --format '{{.Service}} {{.State}} {{.Health}}' >&2 || true
exit 1
