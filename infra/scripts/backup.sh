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

set -euo pipefail

REPO=/srv/ketocare
DEST=/srv/backups
KEEP_DAYS=30
STAMP=$(date +%F)
COMPOSE="docker compose --env-file $REPO/.env -f $REPO/infra/docker-compose.prod.yml"

umask 077
mkdir -p "$DEST"
cd "$REPO"

fail() {
    echo "[$(date '+%F %T')] БЭКАП НЕ СДЕЛАН: $1" >&2
    exit 1
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
echo "  база: postgres-$STAMP.dump ($((SIZE / 1024)) КБ)"

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
    echo "  том $volume: $volume-$STAMP.tar.gz ($(($(wc -c < "$DEST/$volume-$STAMP.tar.gz") / 1024)) КБ)"
done

# --- уборка старого ----------------------------------------------------------
# Только после того, как новое успешно легло: иначе неудачный прогон удалял бы
# последнюю рабочую копию.
find "$DEST" -maxdepth 1 -name 'postgres-*.dump' -mtime "+$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -name '*.tar.gz' -mtime "+$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -name '.*.part' -mtime +1 -delete

echo "[$(date '+%F %T')] готово; копий в каталоге: $(find "$DEST" -maxdepth 1 -name 'postgres-*.dump' | wc -l)"
echo "ВНИМАНИЕ: копия за пределы этого диска не делается — настройте rclone/scp отдельно."
