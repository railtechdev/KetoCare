"""Единственная точка подготовки данных пациента для промпта (раздел 10.2 ТЗ).

Правило 6 `CLAUDE.md`: в промпты не уходят ФИО, контакты и `chat_id`. Пациент
представляется строкой `patient <short-id>, возраст X лет Y мес, пол`.

Подход — **список разрешённого наизнанку**: нагрузка чистится рекурсивно, и
ключ, похожий на имя или контакт, снимается на любой глубине. Проверять только
верхний уровень бессмысленно: ряды дневника, позиции меню и записи о семье
приходят вложенными, и одно поле `full_name` внутри списка утекало бы молча.

Функция ничего не знает ни о конкретной задаче, ни о модели: её вызывает клиент
(`client.py`) перед каждым обращением, и обойти её, не переписав клиент, нельзя.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

#: Ключи, которые не уходят в модель ни на какой глубине.
#:
#: Список задан именами, а не догадками по содержимому: значение «Аня» от
#: значения «мясо» отличить нельзя, а `full_name` от `name_ru` — можно.
#: Названия продуктов, рецептов и диагнозов моделью как раз и нужны — они не
#: идентифицируют человека, поэтому голого `name` в списке нет, а `full_name`,
#: `first_name` и прочие формы имени есть.
FORBIDDEN_KEYS: frozenset[str] = frozenset(
    {
        # Имя человека во всех формах, встречающихся в схеме
        "full_name",
        "first_name",
        "last_name",
        "middle_name",
        "patronymic",
        "parent_name",
        "doctor_name",
        "patient_name",
        "requested_by_name",
        "author_name",
        "display_name",
        # Контакты
        "email",
        "phone",
        "phone_number",
        "contact",
        "contacts",
        "address",
        "telegram",
        "telegram_username",
        "username",
        # Телеграм: chat_id прямо назван в разделе 10.2 ТЗ
        "chat_id",
        "telegram_chat_id",
        "telegram_user_id",
        # Учётные данные — им в промпте делать нечего тем более
        "password",
        "password_hash",
        "totp_secret",
        "token",
        "access_token",
        "refresh_token",
    }
)

#: Ключ, значение которого заменяется меткой пациента.
PATIENT_KEY = "patient"

_MONTHS_IN_YEAR = 12


def pseudonymize(payload: Any) -> Any:
    """Убрать из нагрузки всё, по чему человека можно узнать.

    Словарь `patient` заменяется одной строкой-меткой (`patient_label`): модели
    нужен возраст и пол, а не личность. Остальные запрещённые ключи снимаются
    вместе со значениями — подмена на «***» оставила бы в промпте сам факт, что
    поле есть, и приглашала бы модель о нём спросить.
    """

    if isinstance(payload, dict):
        result: dict[str, Any] = {}
        for key, value in payload.items():
            lowered = key.lower()
            if lowered in FORBIDDEN_KEYS:
                continue
            if lowered == PATIENT_KEY and isinstance(value, dict):
                result[key] = _patient_from(value)
                continue
            result[key] = pseudonymize(value)
        return result

    if isinstance(payload, list):
        return [pseudonymize(item) for item in payload]

    if isinstance(payload, tuple):
        return tuple(pseudonymize(item) for item in payload)

    return payload


def _patient_from(patient: dict[str, Any]) -> str:
    """Метка пациента из его словаря — или пустая, если данных не хватает.

    Не хватает — значит метка не собирается: отдать сюда исходный словарь «раз
    уж возраста нет» означало бы отправить в модель ФИО.
    """

    identifier = patient.get("id")
    birth_date = patient.get("birth_date")
    sex = patient.get("sex")

    if identifier is None:
        return "patient (данные не переданы)"

    if isinstance(birth_date, str):
        try:
            birth_date = date.fromisoformat(birth_date)
        except ValueError:
            birth_date = None

    return patient_label(
        patient_id=identifier,
        birth_date=birth_date if isinstance(birth_date, date) else None,
        sex=str(sex) if sex is not None else None,
    )


def patient_label(
    *,
    patient_id: uuid.UUID | str,
    birth_date: date | None,
    sex: str | None,
    today: date | None = None,
) -> str:
    """`patient 3f2a1c9d, возраст 4 года 2 мес, пол ж` (раздел 10.2 ТЗ).

    Короткий идентификатор — первые восемь знаков UUID. Он нужен, чтобы в
    диалоге о нескольких детях модель их не путала, и при этом ничего не
    говорит о человеке: в базу по нему не зайти, а вне журнала он не значит
    ничего.

    Возраст — а не дата рождения: дата рождения вместе с полом и городом
    идентифицирует ребёнка, а для расчёта достаточно «сколько ему лет».
    """

    short = str(patient_id).replace("-", "")[:8]
    parts = [f"patient {short}"]

    if birth_date is not None:
        parts.append(f"возраст {_age_ru(birth_date, today or date.today())}")
    if sex is not None:
        parts.append(f"пол {_sex_ru(sex)}")

    return ", ".join(parts)


def _age_ru(birth_date: date, today: date) -> str:
    """Возраст словами: «4 года 2 мес», «7 мес», «0 мес».

    Месяцы важны наравне с годами: кетотерапию начинают и грудным детям, и
    «1 год» вместо «1 год 11 мес» — это другой ребёнок с точки зрения питания.
    """

    months = (today.year - birth_date.year) * _MONTHS_IN_YEAR + (today.month - birth_date.month)
    if today.day < birth_date.day:
        months -= 1
    months = max(months, 0)

    years, rest = divmod(months, _MONTHS_IN_YEAR)
    if years == 0:
        return f"{rest} мес"
    return f"{years} {_years_ru(years)} {rest} мес"


def _years_ru(years: int) -> str:
    if years % 10 == 1 and years % 100 != 11:
        return "год"
    if years % 10 in (2, 3, 4) and years % 100 not in (12, 13, 14):
        return "года"
    return "лет"


def _sex_ru(sex: str) -> str:
    return {"m": "м", "f": "ж"}.get(sex.lower(), sex)
