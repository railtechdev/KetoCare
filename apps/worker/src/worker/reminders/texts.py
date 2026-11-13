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
    "reminder_medications": "Напоминание: пора дать лекарства 💊",
    # Прежний текст звал отметить спокойный день «самочувствием» — и семья
    # записывала «всё хорошо» как симптом. Записи «жалоб нет» в дневнике нет
    # (ADR-0076), поэтому напоминание зовёт записать то, что было, и не
    # обещает отметки, которой не существует.
    "reminder_no_records": (
        "За сегодня в дневнике нет записей. Если что-то было — запишите: "
        "кнопкой ниже, в меню этого чата или в приложении."
    ),
    # --- кнопки под сообщениями (ADR-0076)
    "btn_record_ketones": "🩸 Записать кетоны",
    "btn_record_weight": "⚖️ Записать вес",
    "btn_record_medications": "💊 Отметить лекарства",
    "btn_record_wellbeing": "🙂 Записать самочувствие",
    "btn_open_diary": "📱 Открыть дневник",
    "btn_open_menu": "📱 Открыть меню",
    "btn_open_family": "📱 Открыть «Близкие»",
    # --- новое назначение (раздел 5.4 ТЗ) — без чисел (раздел 7.5)
    "prescription_changed": (
        "Врач обновил назначение. Откройте приложение — кнопка «Приложение» слева "
        "от поля ввода — и заново составьте меню на сегодня и завтра под новые цели."
    ),
    "prescription_starts": (
        "Врач записал новое назначение — оно начнёт действовать {when}. До этого "
        "дня меню составляйте по прежнему. Новые цели видны в приложении — кнопка "
        "«Приложение» слева от поля ввода."
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
    # --- меню от специалиста (ADR-0047). Дата числом, а не «на сегодня /
    # на завтра»: задача может уйти позже, чем поставлена, а слово «сегодня»,
    # посчитанное в момент постановки, к утру стало бы неправдой.
    "menu_composed": (
        "{name}, {role}, составил(а) меню на {date}. Откройте приложение, вкладка «Меню»."
    ),
    "role_doctor_lower": "врач",
    "role_dietitian_lower": "диетолог",
    "role_other_lower": "специалист",
    # --- смена пароля кабинета из Telegram (ADR-0051)
    "password_changed": (
        "Пароль от кабинета изменён из приложения в Telegram.\n\n"
        "Если это были не вы, сразу сообщите врачу: он отключит чужое устройство, "
        "а администратор клиники выдаст вам временный пароль."
    ),
    # --- безопасность учётной записи (находки Н2 и Н7 security-прохода)
    "device_linked": (
        "К вашей учётной записи KetoCare подключён ещё один Telegram — кодом "
        "«Подключить свой Telegram».\n\n"
        "Если это были не вы, сразу сообщите врачу: он отключит чужое устройство. "
        "Первые сутки с нового устройства нельзя задать вход в кабинет."
    ),
    "web_credentials_set": (
        "Для вашей учётной записи KetoCare включён вход в кабинет по почте и паролю.\n\n"
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
    "reminder_medications": "Eslatma: dorilarni berish vaqti keldi 💊",
    "reminder_no_records": (
        "Bugun kundalikda hali yozuv yo‘q. Agar biror narsa bo‘lgan bo‘lsa — yozib "
        "qo‘ying: pastdagi tugma, shu chatdagi menyu yoki ilova orqali."
    ),
    "btn_record_ketones": "🩸 Ketonlarni yozish",
    "btn_record_weight": "⚖️ Vaznni yozish",
    "btn_record_medications": "💊 Dorilarni belgilash",
    "btn_record_wellbeing": "🙂 O‘zini his qilishni yozish",
    "btn_open_diary": "📱 Kundalikni ochish",
    "btn_open_menu": "📱 Menyuni ochish",
    "btn_open_family": "📱 «Yaqinlar»ni ochish",
    "prescription_changed": (
        "Shifokor tayinlovni yangiladi. Ilovani oching — yozish maydonining chap "
        "tomonidagi «Ilova» tugmasi — va bugungi hamda ertangi menyuni "
        "yangi maqsadlarga moslab qaytadan tuzing."
    ),
    "prescription_starts": (
        "Shifokor yangi tayinlov yozdi — u {when}dan amal qila boshlaydi. Shu kungacha "
        "menyuni avvalgidek tuzing. Yangi maqsadlar ilovada — yozish maydonining chap "
        "tomonidagi «Ilova» tugmasi."
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
    "menu_composed": "{name} ({role}) {date} uchun menyu tuzdi. Ilovani oching, «Menyu» bo‘limi.",
    "role_doctor_lower": "shifokor",
    "role_dietitian_lower": "dietolog",
    "role_other_lower": "mutaxassis",
    "password_changed": (
        "Kabinet paroli Telegramdagi ilova orqali o‘zgartirildi.\n\n"
        "Agar buni siz qilmagan bo‘lsangiz, darhol shifokorga xabar bering: u "
        "begona qurilmani o‘chiradi, klinika administratori esa sizga vaqtinchalik "
        "parol beradi."
    ),
    "device_linked": (
        "KetoCare hisobingizga yana bitta Telegram ulandi — «O‘z Telegramimni "
        "ulash» kodi orqali.\n\n"
        "Agar buni siz qilmagan bo‘lsangiz, darhol shifokorga xabar bering: u "
        "begona qurilmani o‘chiradi. Yangi qurilmadan birinchi sutka davomida "
        "kabinetga kirishni sozlab bo‘lmaydi."
    ),
    "web_credentials_set": (
        "KetoCare hisobingiz uchun kabinetga pochta va parol bilan kirish yoqildi.\n\n"
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
