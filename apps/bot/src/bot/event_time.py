"""Когда произошло событие: разбор времени, введённого в чате.

Бот ставил моментом события момент отправки. Родитель, записывающий вечером
утренний замер кетонов, тем самым сдвигал его на десять часов — а по времени
замеров врач судит о динамике: утренний кетоз и вечерний это разные вещи.

Разбор вынесен сюда и не знает ни Telegram, ни API: у него есть текст, местное
«сейчас» и часовой пояс семьи. Так его можно проверить целиком, а сценарии
остаются про переходы состояний.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

#: Насколько назад разрешено датировать запись.
#:
#: Не ограничение методики, а защита от опечатки: «01.09» вместо «01.10»
#: отправило бы замер на месяц назад, и это увидел бы врач, а не тот, кто вводил.
#: Неделя закрывает случай «записываю за выходные» и оставляет ошибку заметной.
MAX_BACKDATE = timedelta(days=7)

#: С какого «опережения» дата без года считается прошлогодней.
#:
#: Меньше — это опечатка в ближайших днях («31.08» вместо «30.08»), и о ней
#: надо сказать. Больше — конец прошлого года, записанный в начале нового.
_YEAR_ROLLOVER_GAP = timedelta(days=30)

#: `ЧЧ:ММ` — сегодня; `ДД.ММ ЧЧ:ММ` — другой день этого года.
_TIME_ONLY = re.compile(r"^(\d{1,2})[:.\s](\d{2})$")
_DATE_TIME = re.compile(r"^(\d{1,2})[.\-/](\d{1,2})\s+(\d{1,2})[:.\s](\d{2})$")


class TimeError(str):
    """Причина отказа — строкой, чтобы сценарий показал её как есть."""


def parse_moment(raw: str, *, now: datetime, tz: str) -> datetime | TimeError:
    """Текст из чата → момент в UTC.

    `now` передаётся, а не берётся из часов: иначе разбор нельзя проверить, а
    «не в будущем» и «не старше недели» — это именно про сравнение с ним.
    """

    zone = ZoneInfo(tz)
    local_now = now.astimezone(zone)
    text = raw.strip()

    if match := _TIME_ONLY.match(text):
        hour, minute = int(match.group(1)), int(match.group(2))
        day, month = local_now.day, local_now.month
    elif match := _DATE_TIME.match(text):
        day, month = int(match.group(1)), int(match.group(2))
        hour, minute = int(match.group(3)), int(match.group(4))
    else:
        return TimeError("format")

    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return TimeError("format")

    try:
        moment = local_now.replace(
            month=month, day=day, hour=hour, minute=minute, second=0, microsecond=0
        )
    except ValueError:
        # 31 февраля: календарь отвергает такую дату, и это ошибка ввода.
        return TimeError("format")

    # Год в вводе не указан. Дата, которая ещё не наступила, — это либо конец
    # прошлого года (31 декабря, записанное 1 января), либо опечатка в
    # ближайших днях. Отличаем по расстоянию: «через пару дней» — почти
    # наверняка опечатка, и говорить о ней надо прямо, а не молча уносить
    # запись на год назад.
    is_dated = _DATE_TIME.match(text) is not None
    if is_dated and moment - local_now > _YEAR_ROLLOVER_GAP:
        moment = moment.replace(year=moment.year - 1)

    if moment > local_now:
        return TimeError("future")
    if local_now - moment > MAX_BACKDATE:
        return TimeError("too_old")

    return moment.astimezone(UTC)
