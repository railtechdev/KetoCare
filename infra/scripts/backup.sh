#!/usr/bin/env bash
# Резервная копия пред-прода: дамп базы + тома, которые из дампа не восстановить.
#
# Запускается из cron под пользователем-владельцем стенда:
#   0 3 * * * /srv/ketocare/infra/scripts/backup.sh >> /srv/backups/backup.log 2>&1
#
# Почему отдельный скрипт, а не строка в crontab. Строка вида
#   docker exec … pg_dump … > /srv/backups/x.dump && find … -delete
# создаёт файл ДО запуска pg_dump: при любом отказе (контейнер не поднят, нет
# места, неверный пароль) в каталоге остаётся файл нулевого размера с сегодняшней
# датой. Он выглядит бэкапом, пока не понадобится, — а `find -mtime +30 -delete`
# к тому моменту уже удалил последнюю рабочую копию.
#
# Здесь всё наоборот: сначала во временный файл, проверка, что он непустой и
# что pg_dump завершился успешно, и только потом переименование в рабочее имя.
# Старое удаляется лишь после того, как новое легло на диск.
#
# ШИФРОВАНИЕ (раздел 11 ТЗ). Копия содержит всё: ФИО детей, диагнозы, дневники
# приступов, выписки. Лежать в открытом виде она не должна нигде — ни на этом
# диске, ни во внешнем хранилище, куда её увезут. Получатель задаётся
# `BACKUP_AGE_RECIPIENT` (публичный ключ age); приватный ключ на сервере не
# хранится — иначе шифрование защищает ровно ни от чего.
#
# Без ключа скрипт ОТКАЗЫВАЕТСЯ работать. Это сознательно: предупреждение в
# конце прогона, которое здесь стояло раньше, честно называло проблему и ничего
# не меняло — копии продолжали копиться открытыми. Осознанный отказ от
# шифрования возможен (`BACKUP_ALLOW_PLAINTEXT=1`), но его придётся написать
# руками, и он останется в crontab на виду.
#
# ВНЕШНЕЕ ХРАНИЛИЩЕ. `BACKUP_REMOTE` — цель для `rclone copy` (например
# `s3:ketocare-backups`). Отказ диска уничтожает и прод, и все тридцать копий
# разом: retention и проверка восстановления в этом сценарии не помогают ничем.

set -euo pipefail

REPO=/srv/ketocare
DEST=/srv/backups
KEEP_DAYS=30
STAMP=$(date +%F)
COMPOSE="docker compose --env-file $REPO/.env -f $REPO/infra/docker-compose.prod.yml"

umask 077
mkdir -p "$DEST"
cd "$REPO"

# Настройки читаются из того же файла, куда их кладёт администратор по
# docs/DEPLOY.md. Из cron скрипт запускается голой строкой, без окружения:
# читать переменные только из него значило бы дать администратору инструкцию,
# выполнение которой ничего не меняет, — и получать отказ каждую ночь в лог,
# который никто не читает. Тот же приём, что в deploy.sh.
if [ -f "$REPO/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$REPO/.env"
    set +a
fi

AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
REMOTE="${BACKUP_REMOTE:-}"
ALLOW_PLAINTEXT="${BACKUP_ALLOW_PLAINTEXT:-}"

fail() {
    echo "[$(date '+%F %T')] БЭКАП НЕ СДЕЛАН: $1" >&2
    exit 1
}

if [ -z "$AGE_RECIPIENT" ] && [ -z "$ALLOW_PLAINTEXT" ]; then
    fail "не задан BACKUP_AGE_RECIPIENT — копия клинической базы не должна лежать открытой.
  Ключ создаётся на ЧУЖОЙ машине: age-keygen -o key.txt (приватный храните вне сервера),
  публичный (age1…) положите в BACKUP_AGE_RECIPIENT в /srv/ketocare/.env.
  Осознанный отказ: BACKUP_ALLOW_PLAINTEXT=1."
fi
if [ -n "$AGE_RECIPIENT" ] && ! command -v age >/dev/null 2>&1; then
    fail "BACKUP_AGE_RECIPIENT задан, а age не установлен: apt-get install -y age"
fi

# Шифрует файл на месте: рядом появляется .age, исходник удаляется. Открытая
# копия не переживает прогон — иначе смысла в шифровании нет.
encrypt() {
    [ -n "$AGE_RECIPIENT" ] || return 0
    if ! age -r "$AGE_RECIPIENT" -o "$1.age" "$1"; then
        # Открытая копия не переживает прогон даже при отказе шифрования. Иначе
        # первое же падение `age` — кончилось место, битый ключ — оставляло бы
        # незашифрованный дамп клинической базы лежать тридцать дней до
        # retention, ровно там, откуда его и убирали.
        rm -f "$1" "$1.age"
        fail "не удалось зашифровать $1 (открытая копия удалена)"
    fi
    rm -f "$1"
}

echo "[$(date '+%F %T')] начало"

# --- база --------------------------------------------------------------------
# -Fc: custom format, восстанавливается pg_restore и сжат сам по себе.
TMP="$DEST/.postgres-$STAMP.dump.part"
trap 'rm -f "$TMP"' EXIT

$COMPOSE exec -T postgres pg_dump -U ketocare -Fc ketocare > "$TMP" \
    || fail "pg_dump завершился с ошибкой"

# Пустой или подозрительно маленький дамп — это отказ, а не результат.
# Схема KetoCare (31 таблица) со справочниками даёт заметно больше 50 КБ.
SIZE=$(wc -c < "$TMP")
[ "$SIZE" -gt 51200 ] || fail "дамп подозрительно мал: $SIZE байт"

mv "$TMP" "$DEST/postgres-$STAMP.dump"
trap - EXIT
encrypt "$DEST/postgres-$STAMP.dump"
echo "  база: postgres-$STAMP.dump${AGE_RECIPIENT:+.age} ($((SIZE / 1024)) КБ)"

# --- тома, которые дамп не содержит ------------------------------------------
# `pg_dump` сохраняет строку таблицы attachments, но не байты файла, а выписка
# из стационара существует в одном экземпляре (ADR-0013). Том erased — то
# единственное, что остаётся от пациента после удаления по требованию (ТЗ §11).
# Том reports не копируется: PDF пересобирается из базы.
for volume in attachments erased; do
    TMP="$DEST/.$volume-$STAMP.tar.gz.part"
    trap 'rm -f "$TMP"' EXIT
    docker run --rm -v "ketocare_$volume:/data:ro" alpine \
        tar czf - -C /data . > "$TMP" || fail "не удалось заархивировать том $volume"
    mv "$TMP" "$DEST/$volume-$STAMP.tar.gz"
    trap - EXIT
    SIZE=$(wc -c < "$DEST/$volume-$STAMP.tar.gz")
    encrypt "$DEST/$volume-$STAMP.tar.gz"
    echo "  том $volume: $volume-$STAMP.tar.gz${AGE_RECIPIENT:+.age} ($((SIZE / 1024)) КБ)"
done

# --- внешнее хранилище -------------------------------------------------------
# До уборки: если увезти не удалось, пусть на диске останется всё, что есть.
if [ -n "$REMOTE" ]; then
    command -v rclone >/dev/null 2>&1 || fail "BACKUP_REMOTE задан, а rclone не установлен"
    # Шаблоны начинаются с имени, а не со звёздочки: `*-$STAMP.*` подхватил бы и
    # `.postgres-$STAMP.dump.part` — недописанный файл прерванного прогона.
    rclone copy "$DEST" "$REMOTE" --no-traverse \
        --include "postgres-$STAMP.*" \
        --include "attachments-$STAMP.*" \
        --include "erased-$STAMP.*" \
        || fail "не удалось увезти копию в $REMOTE"
    echo "  увезено в $REMOTE"
fi

# --- уборка старого ----------------------------------------------------------
# Только после того, как новое успешно легло: иначе неудачный прогон удалял бы
# последнюю рабочую копию.
find "$DEST" -maxdepth 1 -name 'postgres-*.dump' -mtime "+$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -name 'postgres-*.dump.age' -mtime "+$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -name '*.tar.gz' -mtime "+$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -name '*.tar.gz.age' -mtime "+$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -name '.*.part' -mtime +1 -delete

COPIES=$(find "$DEST" -maxdepth 1 -name 'postgres-*.dump*' | wc -l)
echo "[$(date '+%F %T')] готово; копий в каталоге: $COPIES"
[ -n "$REMOTE" ] || echo "ВНИМАНИЕ: BACKUP_REMOTE не задан — копия остаётся только на этом диске."
