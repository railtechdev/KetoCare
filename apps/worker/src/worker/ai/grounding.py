"""Сверка чисел сводки с рядами, которые в неё передали.

Лексический фильтр — эвристика: список слов всегда неполон. Эта проверка —
нет. Вход сводки собираем мы (`api.services.summaries`), значит нам известно
полное множество чисел, которые имеют право в ней оказаться. Число вне
множества — выдумка по построению, а не «почти верное значение».

Приём не новый: `parse.py` так же отвергает разбор еды с `product_id`, которого
не было в переданном справочнике. Разница в цене ошибки — выдуманное «кетоны
выросли до 4.3» врач прочитает как факт и перепроверить не сможет: рядов у него
перед глазами нет, в этом и смысл сводки.

**Что считается обоснованным.** Само переданное число (или его модуль:
«снижение на 0.2 кг» при `delta_kg = -0.2`); целое от нуля до числа дней периода
— порядковые «три дня подряд», «на второй неделе»; дата внутри периода. Всё
остальное — находка.

**Почему не выводятся разности и доли.** Первый прогон их выводил, и проверка
почти ослепла: в нагрузке полсотни чисел, их попарные разности покрывают всё
мелкое пространство значений — выдуманное «выросли с 2.1» проходило как
`4 − 1.9`. Вместо этого каждую производную величину, которая может понадобиться
сводке, считает и передаёт `api.services.summaries`: разницу веса, долю
отмеченных приёмов, долю дней с записями, средние отклонения. Число, которого
там нет, сводке брать неоткуда — в этом весь смысл проверки.

**Чего проверка не ловит.** Верную арифметику по неверному поводу: «в среднем
2.4» там, где 2.4 — это максимум. Числа сверяются как множество, без привязки к
смыслу, и это осознанный предел: привязка требовала бы разбора русского
предложения, а не чисел.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any

from core.textguard import sentences

#: Допуск сравнения. Модель округляет по-своему: 87.3 % может стать «87 %», а
#: 2.4 ммоль/л — «2,4». Различие в сотых — форматирование, а не выдумка.
TOLERANCE = 0.051

#: Сколько находок отдавать. Сводка с двумя десятками непроверяемых чисел —
#: сама по себе находка; перечислять их все незачем.
MAX_FINDINGS = 12

#: Числовой литерал: целое или десятичное, с запятой или точкой.
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")

#: Единицы массы и объёма. Нужны, когда проверяются не все числа подряд, а
#: только величины состава: в способе приготовления «готовьте 4 минуты при 180
#: градусах» — это то, ради чего его и пишут, а «45 г масла» вместо переданных
#: 30 г — другое блюдо.
MASS_UNITS: tuple[str, ...] = ("г", "гр", "грамм", "граммов", "грамма", "кг", "мл", "л")

_MASS_AFTER = re.compile(r"\s*(?:" + "|".join(MASS_UNITS) + r")\b")

#: Дата — ровно две цифры на каждую часть: промпт требует формата ДД.ММ, а
#: `2.6` в сводке это кетоны, а не второе июня. Одноцифренная форма стоила бы
#: находки на каждом десятичном значении: первый же прогон пометил «1.9» как
#: несуществующую дату 1 сентября.
_DATE = re.compile(r"\b(\d{2})[.](\d{2})(?:[.](\d{2,4}))?\b")
#: Диапазон «1.9–3.2» и соотношение «4:1» — отдельные формы, но оба разбираются
#: как обычные числа: каждый конец обязан быть обоснован сам по себе.


@dataclass(frozen=True, slots=True)
class Ungrounded:
    """Число из сводки, которого нет в переданных рядах."""

    value: float
    fragment: str

    def as_dict(self) -> dict[str, Any]:
        return {"value": self.value, "fragment": self.fragment}


def collect_numbers(payload: Any) -> set[float]:
    """Все числа нагрузки, на любой глубине.

    Строки не разбираются: `dose = "300 мг"` — это подпись, а не величина, и
    число из неё сводка вправе повторить. Поэтому числа из строк добавляются
    тоже, но отдельным правилом — см. `_from_text`.
    """

    found: set[float] = set()
    _walk(payload, found)
    return found


def _walk(node: Any, found: set[float]) -> None:
    if isinstance(node, bool):
        return
    if isinstance(node, int | float):
        # Модуль тоже: «снижение на 0.2 кг» при `delta_kg = -0.2` — то же число,
        # знак в тексте несёт слово, а не цифра.
        found.add(float(node))
        found.add(abs(float(node)))
        return
    if isinstance(node, str):
        found.update(_from_text(node))
        return
    if isinstance(node, dict):
        for value in node.values():
            _walk(value, found)
        return
    if isinstance(node, list | tuple):
        for value in node:
            _walk(value, found)


def _from_text(text: str) -> set[float]:
    """Числа внутри строкового значения нагрузки — доза «300 мг», версия ядра.

    Даты в ISO (`2026-08-01`) сюда не попадают: их разбирает `_dates_of`.
    """

    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return set()
    return {float(match.replace(",", ".")) for match in _NUMBER.findall(text)}


def _dates_of(payload: Any) -> set[tuple[int, int]]:
    """Дни и месяцы всех ISO-дат нагрузки — как пары (день, месяц)."""

    found: set[tuple[int, int]] = set()
    _walk_dates(payload, found)
    return found


def _walk_dates(node: Any, found: set[tuple[int, int]]) -> None:
    if isinstance(node, str):
        match = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", node)
        if match:
            found.add((int(match.group(3)), int(match.group(2))))
        return
    if isinstance(node, dict):
        for value in node.values():
            _walk_dates(value, found)
        return
    if isinstance(node, list | tuple):
        for value in node:
            _walk_dates(value, found)


def check(text: str, payload: dict[str, Any], *, only_masses: bool = False) -> list[Ungrounded]:
    """Числа текста, которых в переданной нагрузке нет.

    `only_masses` — проверять лишь величины с единицей массы или объёма. Так
    смотрят карточку рецепта: состав закрыт, и граммовка не из списка ломает
    расчёт блюда, а время и температуру модель как раз и придумывает — это её
    работа. У сводки проверяются все числа: там придумывать нечего.

    Не бросает исключений. Черновик к этому моменту уже оплачен, и падение на
    нём стоило бы дорого дважды: текст потерян, а строка осталась бы в
    `running` — повторный заказ за тот же период возвращал бы её же, и сводку за
    этот период нельзя было бы собрать никогда. Сбой самой проверки становится
    находкой, как и в `core.textguard`.
    """

    try:
        return _check(text, payload, only_masses=only_masses)
    except Exception as error:  # noqa: BLE001 — сломанная проверка не роняет черновик
        return [
            Ungrounded(value=0.0, fragment=f"проверка чисел не выполнена: {error}"),
        ]


def _check(text: str, payload: dict[str, Any], *, only_masses: bool = False) -> list[Ungrounded]:
    allowed = collect_numbers(payload)
    dates = _dates_of(payload)
    period = payload.get("period") or {}
    days = int(period.get("days") or 0)
    within_period = _period_days(period)

    findings: list[Ungrounded] = []
    seen: set[float] = set()

    for sentence in sentences(text):
        rest = sentence
        for match in () if only_masses else _DATE.finditer(sentence):
            day, month = int(match.group(1)), int(match.group(2))
            year = int(match.group(3)) if match.group(3) else None
            # Число собирается из групп, а не склейкой строки: «14.08.2026»
            # давало «14.08.08» и падение с ValueError.
            literal = float(f"{day}.{month:02d}")
            known_date = (day, month) in dates or _date_in_period(day, month, year, within_period)
            # Форма ДД.ММ и десятичное «14.02» неразличимы. Сомнение решается в
            # пользу текста: находка ставится, только если литерал не проходит
            # ни как дата периода, ни как обоснованное число.
            if not known_date and not _grounded(literal, allowed, days):
                findings.append(Ungrounded(value=literal, fragment=sentence))
            rest = rest.replace(match.group(0), " ")

        for match in _NUMBER.finditer(rest):
            if only_masses and not _MASS_AFTER.match(rest, match.end()):
                continue
            value = float(match.group(0).replace(",", "."))
            if value in seen:
                continue
            if _grounded(value, allowed, days):
                continue
            seen.add(value)
            findings.append(Ungrounded(value=value, fragment=sentence))

    return findings[:MAX_FINDINGS]


def _grounded(value: float, allowed: set[float], days: int) -> bool:
    if _close(value, allowed):
        return True
    # Порядковые: «три дня подряд», «вторая неделя», «шесть дней без записей».
    # Любое целое, не превосходящее длину периода, посчитать по рядам можно, и
    # запрещать их значило бы получить находку на каждой второй фразе.
    return value.is_integer() and 0 <= value <= days


def _close(value: float, pool: set[float]) -> bool:
    return any(abs(value - item) <= TOLERANCE for item in pool)


def _period_days(period: dict[str, Any]) -> tuple[date, date] | None:
    try:
        return (
            date.fromisoformat(str(period["from"])),
            date.fromisoformat(str(period["to"])),
        )
    except (KeyError, TypeError, ValueError):
        return None


def _date_in_period(
    day: int, month: int, year: int | None, period: tuple[date, date] | None
) -> bool:
    """Дата внутри периода.

    Год модель обычно не пишет — промпт требует ДД.ММ, — и тогда он подбирается:
    период может пересекать новый год, и перебрать два года дешевле, чем
    угадывать. Написанный год проверяется как есть, поэтому «14.08.2025» в
    периоде за август 2026 становится находкой.
    """

    if period is None:
        return False
    start, end = period
    years = {year} if year is not None else {start.year, end.year}
    for candidate in years:
        full = candidate + 2000 if candidate < 100 else candidate
        try:
            when = date(full, month, day)
        except ValueError:
            continue
        if start <= when <= end:
            return True
    return False
