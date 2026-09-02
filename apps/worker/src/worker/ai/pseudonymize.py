"""Единственная точка подготовки данных пациента для промпта (раздел 10.2 ТЗ).

Правило 6 `CLAUDE.md`: в промпты не уходят ФИО, контакты и `chat_id`. Пациент
представляется строкой `patient <short-id>, возраст X лет Y мес, пол`.

Чистка идёт рекурсивно и по трём правилам сразу — одного мало, у каждого своя
дыра:

1. **Запрещённые ключи** (`FORBIDDEN_KEYS`) снимаются на любой глубине. Это
   список запретов, а не разрешений, и его слабость известна: ключ, которого в
   списке нет, пройдёт насквозь. Проверять только верхний уровень было бы ещё
   хуже: ряды дневника, позиции меню и записи о семье приходят вложенными, и
   одно поле `full_name` внутри списка утекало бы молча.
2. **Словарь, похожий на человека** (есть `id` и `birth_date`), заменяется
   меткой — независимо от того, как назван ключ. Правило закрывает главную дыру
   первого: `{"child": {...}}` и `{"sibling": {...}}` больше не проносят дату
   рождения мимо запрета, потому что искать по имени ключа их бесполезно.
3. **Значения приводятся к JSON-совместимым** (`date`, `Decimal`, `UUID`):
   репозитории `core` отдают именно их, а нагрузка едет и в промпт, и в
   `ai_jobs.input` — то есть через `json.dumps` дважды.

Свободный текст человека чистит отдельная `scrub_free_text`: там нельзя убрать
всё (имя ребёнка в фразе «Аня съела два яйца» неотличимо от слова), но контакты
— можно, и они убираются (ADR-0019).

Функция ничего не знает ни о конкретной задаче, ни о модели: её вызывает клиент
(`client.py`) перед каждым обращением, и обойти её, не переписав клиент, нельзя.
"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from decimal import Decimal
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
        "child_name",
        "nickname",
        "mother",
        "father",
        "guardian",
        "guardian_name",
        "caregiver",
        # Дата рождения. Вместе с полом она идентифицирует ребёнка не хуже
        # имени, а модели нужен возраст — он приходит в метке.
        "birth_date",
        "birthday",
        "dob",
        # Контакты
        "email",
        "phone",
        "phone_number",
        "contact",
        "contacts",
        "address",
        "telegram",
        "telegram_username",
        "tg_username",
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
        if _looks_like_a_person(payload):
            # Правило 2: словарь человека распознаётся по содержимому, а не по
            # имени ключа. `patient`, `child`, `sibling`, `subject` — искать их
            # списком имён значит проигрывать первому же новому названию.
            return _patient_from(payload)

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

    return _as_json_value(payload)


def _looks_like_a_person(node: dict[str, Any]) -> bool:
    """Есть идентификатор и дата рождения — это карточка человека.

    Пара, а не одно поле: `id` есть у продукта и рецепта, `birth_date` без
    идентификатора встречается в анкете. Вместе они бывают только у человека.
    """

    keys = {key.lower() for key in node}
    return "id" in keys and bool(keys & {"birth_date", "birthday", "dob"})


def _as_json_value(value: Any) -> Any:
    """Привести значение к тому, что переживёт `json.dumps`.

    Репозитории `core` отдают `date`, `Decimal` (граммы и дозы — `Numeric`) и
    `uuid.UUID`. Без приведения первая же настоящая задача падала бы голым
    `TypeError` на записи в журнал — то есть до обращения к модели, но и мимо
    обещанного «наружу идёт один понятный тип».
    """

    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


#: Что вырезается из свободного текста: почта, телефон, ник в Telegram.
#:
#: Имя человека не ищется намеренно: «Аня съела два яйца» — здесь имя от слова
#: неотличимо, а попытка угадать испортила бы сам текст, ради которого разбор и
#: делается. Остаток риска описан в ADR-0019.
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE = re.compile(r"(?<!\d)\+?\d[\d\s()-]{8,}\d(?!\d)")
_TG_USERNAME = re.compile(r"(?<![\w@])@[A-Za-z][A-Za-z0-9_]{4,}")

MASK = "[скрыто]"


def scrub_free_text(text: str | None) -> str | None:
    """Убрать контакты из текста, который человек набрал сам.

    Раздел 10.2 ТЗ запрещает контакты в промптах без оговорок — «это же ввод
    пользователя» такой оговоркой не является. Родитель может написать телефон
    или почту в вопросе ассистенту, и до этой функции они уходили бы и в модель,
    и в `ai_jobs.input`.
    """

    if text is None:
        return None

    cleaned = _EMAIL.sub(MASK, text)
    cleaned = _TG_USERNAME.sub(MASK, cleaned)
    return _PHONE.sub(MASK, cleaned)


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
