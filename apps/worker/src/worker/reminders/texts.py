"""Тексты сообщений воркера в Telegram — по-русски и по-узбекски (ADR-0052).

Сообщение уходит на языке взрослого, чей это чат (`users.language`): бот,
Mini App и рассылки обязаны говорить с человеком одинаково. Узбекский —
латиницей, той же лексикой, что посадочная страница и бот: «tayinlov»,
«kundalik», «Yaqinlar», «Ilova».

Узбекские формулировки написаны командой разработки и до запуска требуют
вычитки носителем языка (ADR-0052, проверка перед запуском). Клинического в
них нет — как и в русских: ни чисел назначения, ни советов (раздел 7.5 ТЗ).
Перечень анализов к визиту приходит из `core.control_schedule` по-русски: это
клинический текст, и перевод его — дело клиники.

Ключи у языков обязаны совпадать вместе с переменными подстановки: это держит
`tests/test_texts_catalog.py`, иначе узбекская семья получила бы `KeyError`
вместо напоминания.
"""

from __future__ import annotations

from typing import Final

from core.languages import DEFAULT_LANGUAGE, effective

RU: Final[dict[str, str]] = {
    # --- напоминания (раздел 7.4 ТЗ) — мягкие и без упрёка
    "reminder_ketones": "Напоминание: пора измерить кетоны 🩸",
    "reminder_weight": "Напоминание: пора взвесить ребёнка ⚖️",
    "reminder_medications": "Напоминание: приём препаратов по схеме 💊",
    # «Так и отметьте» обещало кнопку «спокойный день», которой нет: отметить
    # спокойный день можно тем, что есть, — самочувствием.
    "reminder_no_records": (
        "За сегодня в дневнике нет записей. Если день прошёл спокойно — "
        "отметьте самочувствие кнопкой «🙂 Самочувствие»: врачу важно видеть "
        "и спокойные дни."
    ),
    # --- новое назначение (раздел 5.4 ТЗ) — без чисел (раздел 7.5)
    "prescription_changed": (
        "Врач обновил назначение. Откройте приложение — кнопка «Приложение» слева "
        "от поля ввода — и заново соберите план питания на сегодня и завтра под новые цели."
    ),
    # --- новый близкий (ADR-0043)
    "joined": (
        "К дневнику ребёнка подключился новый близкий: {newcomer}{by}.\n\n"
        "Если вы не знаете этого человека, откройте приложение, раздел «Близкие», "
        "и закройте ему доступ — или скажите врачу."
    ),
    "joined_by": " по приглашению: {inviter}",
    # --- просьба специалиста (ADR-0046)
    "nudge": (
        "{role} {name} просит отметить в дневнике, как прошли последние дни.\n\n"
        "Записать можно кнопками в этом чате или в приложении."
    ),
    "role_doctor": "Врач",
    "role_dietitian": "Диетолог",
    "role_other": "Специалист",
    # --- план дня от специалиста (ADR-0047)
    "menu_composed": (
        "{name}, {role}, составил(а) план питания на {date}. Откройте приложение, вкладка «Меню»."
    ),
    "role_doctor_lower": "врач",
    "role_dietitian_lower": "диетолог",
    "role_other_lower": "специалист",
    # --- смена пароля кабинета из Telegram (ADR-0051)
    "password_changed": (
        "Пароль от кабинета KetoCare изменён из приложения в Telegram.\n\n"
        "Если это были не вы, сразу сообщите врачу: он отключит чужое устройство, "
        "а администратор клиники выдаст вам временный пароль."
    ),
    # --- контрольный визит (ADR-0050)
    "visit": "Напоминание: {when} — контрольный визит к врачу 🗓",
    "visit_date": "{day} {month}",
    "visit_labs": "\n\nАнализы и обследования к визиту: {labs}.",
    "visit_reschedule": "\n\nЕсли дату нужно перенести, свяжитесь с клиникой.",
}

UZ: Final[dict[str, str]] = {
    "reminder_ketones": "Eslatma: ketonlarni o‘lchash vaqti keldi 🩸",
    "reminder_weight": "Eslatma: bolani tortish vaqti keldi ⚖️",
    "reminder_medications": "Eslatma: dorilarni sxema bo‘yicha berish vaqti 💊",
    "reminder_no_records": (
        "Bugun kundalikda hali yozuv yo‘q. Agar kun tinch o‘tgan bo‘lsa, "
        "«🙂 O‘zini his qilish» tugmasi bilan belgilab qo‘ying: shifokor uchun "
        "tinch kunlarni ko‘rish ham muhim."
    ),
    "prescription_changed": (
        "Shifokor tayinlovni yangiladi. Ilovani oching — yozish maydonining chap "
        "tomonidagi «Ilova» tugmasi — va bugungi hamda ertangi ovqatlanish rejasini "
        "yangi maqsadlarga moslab qaytadan tuzing."
    ),
    "joined": (
        "Bola kundaligiga yangi yaqin qo‘shildi: {newcomer}{by}.\n\n"
        "Agar bu odamni tanimasangiz, ilovani oching, «Yaqinlar» bo‘limida unga "
        "kirishni yoping — yoki shifokorga ayting."
    ),
    "joined_by": " ({inviter} taklifi bilan)",
    "nudge": (
        "{role} {name} so‘nggi kunlar qanday o‘tganini kundalikda belgilab "
        "qo‘yishingizni so‘rayapti.\n\n"
        "Bu chatdagi tugmalar orqali yoki ilovada yozish mumkin."
    ),
    "role_doctor": "Shifokor",
    "role_dietitian": "Dietolog",
    "role_other": "Mutaxassis",
    "menu_composed": (
        "{name} ({role}) {date} uchun ovqatlanish rejasini tuzdi. Ilovani oching, «Menyu» bo‘limi."
    ),
    "role_doctor_lower": "shifokor",
    "role_dietitian_lower": "dietolog",
    "role_other_lower": "mutaxassis",
    "password_changed": (
        "KetoCare kabineti paroli Telegramdagi ilova orqali o‘zgartirildi.\n\n"
        "Agar buni siz qilmagan bo‘lsangiz, darhol shifokorga xabar bering: u "
        "begona qurilmani o‘chiradi, klinika administratori esa sizga vaqtinchalik "
        "parol beradi."
    ),
    "visit": "Eslatma: {when} — shifokorga nazorat tashrifi 🗓",
    "visit_date": "{day}-{month}",
    "visit_labs": "\n\nTashrifga tahlil va tekshiruvlar: {labs}.",
    "visit_reschedule": "\n\nSanani ko‘chirish kerak bo‘lsa, klinika bilan bog‘laning.",
}

#: Месяц в дате визита: по-русски — в родительном падеже («5 октября»),
#: по-узбекски — как пишет сама дата («5-oktabr»).
MONTHS: Final[dict[str, tuple[str, ...]]] = {
    "ru": (
        "января",
        "февраля",
        "марта",
        "апреля",
        "мая",
        "июня",
        "июля",
        "августа",
        "сентября",
        "октября",
        "ноября",
        "декабря",
    ),
    "uz": (
        "yanvar",
        "fevral",
        "mart",
        "aprel",
        "may",
        "iyun",
        "iyul",
        "avgust",
        "sentabr",
        "oktabr",
        "noyabr",
        "dekabr",
    ),
}

CATALOG: Final[dict[str, dict[str, str]]] = {"ru": RU, "uz": UZ}


def text(language: str | None, key: str, **values: object) -> str:
    """Текст на языке человека; несохранённый или незнакомый язык — русский."""

    catalog = CATALOG.get(effective(language), CATALOG[DEFAULT_LANGUAGE])
    return catalog[key].format(**values) if values else catalog[key]


def month(language: str | None, number: int) -> str:
    return MONTHS[effective(language)][number - 1]
