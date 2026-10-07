"""Bot matnlari o‘zbek tilida (lotin yozuvi) — `texts_ru.py` ning aynan nusxasi.

Узбекские тексты бота (ADR-0052, решение заказчика G3). Имена и подстановки
обязаны совпадать с `texts_ru.py` один в один: это держит
`tests/test_language.py` — пропущенное имя или лишняя `{переменная}` иначе
всплыли бы у узбекской семьи посреди записи приступа.

Латиница — как на посадочной странице (`packages/landing/src/content/uz.ts`) и
та же лексика: «shifokor», «tayinlov», «kundalik», «xuruj», «Yaqinlar». Апостроф
в «o‘», «g‘» — U+2018, разделительный знак («ma’lumot») — U+2019, тоже как там.

Тексты написаны командой разработки. До запуска их обязан вычитать носитель
языка — это проверка перед запуском в ADR-0052. Клинических утверждений здесь
нет, как и в русских (раздел 7.5 ТЗ): справочники типов приступов и шкалы
длительности приходят с сервера по-русски, их перевод — медицинский текст и
дело клиники.
"""

from __future__ import annotations

# --- Ulash (раздел 7.1) ---

START_NEED_CODE = (
    "Assalomu alaykum! Bu bot bolaning ma’lumotlarini KetoCare’ga yozib boradi.\n\n"
    "Boshlash uchun bu yerga sakkiz belgili kirish kodini yuboring. Uni qabulda "
    "shifokor yoki bolaga kirish huquqi allaqachon bor ota-ona beradi; agar "
    "kabinetingiz ochiq bo‘lsa, kod «Bola» → «Telegram» bo‘limida turadi."
)

START_ALREADY_LINKED = "Bu chat allaqachon ulangan: {patient_name}. Nimani yozamiz — tanlang."
START_ALREADY_LINKED_SEVERAL = (
    "Bu chat bolalarni yuritadi: {children}. Hozir tanlangan: {active}. Nimani yozamiz — tanlang."
)

LINK_SUCCESS = "Tayyor, chat ulandi: {patient_name}.\n\n📝 Kundaliklar — pastdagi tugmalarda.\n"
LINK_SUCCESS_APP_LINE = (
    "📱 Umumiy holat, kun rejasi va grafiklar — yozish maydonining chap tomonidagi "
    "«Ilova» tugmasi.\n"
)
LINK_SUCCESS_CABINET_OFF = (
    "💻 Brauzerdagi kabinet — qabul uchun hisobotlar va hujjatlar. U majburiy emas; "
    "ilovaning «Kabinetga kirish» bo‘limida yoqiladi va {web_url} manzilida ochiladi"
)
LINK_SUCCESS_CABINET_ON = "💻 Brauzerdagi kabinet — qabul uchun hisobotlar va hujjatlar: {web_url}"

LINK_ONLY_PRIVATE = (
    "Bolani faqat men bilan shaxsiy yozishmada ulash mumkin: men bilan chatni "
    "oching va kodni o‘sha yerdan yuboring."
)

LINK_CODE_INVALID = (
    "Kod to‘g‘ri kelmadi: muddati o‘tgan, allaqachon ishlatilgan yoki unda xato bor.\n\n"
    "Harf va raqamlarni tekshiring. Bo‘lmasa — kodni yuborgan odamdan yangisini "
    "so‘rang: shifokordan yoki bolaning ota-onasidan."
)

LINK_ALREADY_HERE = (
    "Bu chat ushbu bolaning kundaligini allaqachon yuritadi — kod kerak emas. "
    "Nimani yozamiz — tanlang."
)

LINK_SUCCESS_SEVERAL = (
    "Tayyor, yana bir bola qo‘shildi: {patient_name}.\n\n"
    "Endi bu chat bolalarni yuritadi: {children}. Yozuvlar tanlangan bolaga "
    "ketadi; bolani almashtirish — pastdagi «{switch}» tugmasi.\n"
)

NOT_LINKED = (
    "Chat hali bolaga ulanmagan. Bu yerga kirish kodini yuboring — sakkizta harf "
    "va raqam. Uni shifokor yoki bolaning ota-onasi beradi."
)

LINK_REVOKED = (
    "Bu chatda kundalikka kirish yopildi. Davom etish uchun sizni taklif qilgan "
    "odamdan yoki shifokordan yangi kod so‘rang va uni shu yerga yuboring."
)
LINK_REVOKED_ONE = (
    "Bu chatda {revoked} kundaligiga kirish yopildi. Yozuvlar endi {active} uchun "
    "ketadi. Kirishni qaytarish uchun sizni taklif qilgan odamdan yoki "
    "shifokordan yangi kod so‘rang."
)

# --- Bir chatda bir nechta bola (ADR-0048) ---

BTN_CHILD_PREFIX = "👶 Bola"
BTN_CHILD = BTN_CHILD_PREFIX + ": {name}"
CHILD_ASK = "Kimning kundaligini yuritamiz? Hozir tanlangan: {active}."
CHILD_CHOSEN = "Tayyor: yozuvlar endi {name} uchun ketadi."
CHILD_GONE = "Bu bola endi chatda yo‘q. Ro‘yxatdan qaytadan tanlang."
SCENARIO_CHILD_GONE = (
    "Yozuv saqlanmadi: uni boshlagan bolangiz endi bu chatda yo‘q. Bolani tanlang "
    "va yozuvni menyudan qaytadan boshlang."
)
SCENARIO_CHILD_UNKNOWN = (
    "Yozuv saqlanmadi: u qaysi bola uchun boshlangani noma’lum. Uni menyudan qaytadan boshlang."
)
CHILD_ONLY_ONE = (
    "Bu chat bitta bolani yuritadi: {name}. Ikkinchisini qo‘shish uchun uning "
    "kirish kodini shu yerga yuboring."
)

# --- Asosiy menyu (раздел 7.2) ---

MENU_PROMPT = "Nimani yozamiz?"

BTN_SEIZURE = "⚡ Xuruj"
BTN_KETONES = "🩸 Ketonlar"
BTN_WEIGHT = "⚖️ Vazn"
BTN_MEAL = "🍽 Ovqat"
BTN_MEDICATION = "💊 Dorilar"
BTN_WELLBEING = "🙂 O‘zini his qilish"
BTN_APP_MENU = "Ilova"

BTN_CANCEL = "Bekor qilish"
CANCELLED = "Bekor qilindi."

# --- Xuruj (раздел 7.3, вопрос 23) ---

SEIZURE_ASK_TYPE = "Qanday xuruj bo‘ldi?"
SEIZURE_NO_TYPES = (
    "Hozir xurujni yozib bo‘lmaydi: tizimda xuruj turlari ro‘yxati to‘ldirilmagan. "
    "Bu haqda shifokorga ayting, hozircha esa xuruj vaqti va davomiyligini "
    "qog‘ozga yoki telefon eslatmalariga yozib qo‘ying."
)
SEIZURE_ASK_COUNT = "Nechta xuruj bo‘ldi?"
BTN_SEIZURE_COUNT_MORE = "5 va undan ko‘p"
SEIZURE_ASK_COUNT_EXACT = "Aniq nechta? Raqam bilan yozing, masalan 7."
SEIZURE_COUNT_INVALID = "{low} dan {high} gacha butun son kerak. Yana bir bor urinib ko‘ring."
# Шкала длительности приходит с сервера по-русски (клинический справочник),
# поэтому подсказка называет границы числами, а не цитирует подпись кнопки.
_DURATION_BOUNDARY_HINT = (
    "Agar aynan chegarada bo‘lsa (5, 10 yoki 30 daqiqa) — kattaroq variantni tanlang."
)
SEIZURE_ASK_DURATION = "Xuruj qancha davom etdi?\n" + _DURATION_BOUNDARY_HINT
SEIZURE_ASK_DURATION_SERIES = "Ulardan eng uzog‘i qancha davom etdi?\n" + _DURATION_BOUNDARY_HINT
SEIZURE_ASK_EXACT = (
    "Xuruj necha soniya davom etdi? Raqam bilan — masalan, 90 (bu bir yarim daqiqa)."
)
SEIZURE_ASK_EXACT_SERIES = (
    "Eng uzog‘i necha soniya davom etdi? Raqam bilan — masalan, 90 (bu bir yarim daqiqa)."
)
SEIZURE_EXACT_INVALID = (
    "0 dan {limit} gacha butun soniyalar soni kerak. Yana bir bor urinib ko‘ring."
)
BTN_SEIZURE_EXACT = "Aniq kiritish"
SEIZURE_SAVED = "{type}, xurujlar soni: {count}, {duration}"
SEIZURE_SAVED_LONGEST = "eng uzog‘i — {duration}"
SEIZURE_SAVED_EXACT_SEC = "{value} s"
SEIZURE_SAVED_EXACT_MIN = "{value} daq"
SEIZURE_UNNAMED_TYPE = "xuruj"
SEIZURE_UNNAMED_DURATION = "davomiyligi ko‘rsatilgan"

# --- Umumiy ---

SAVED = "Yozildi ✓ {summary} ({when})"
SAVED_BARE = "Yozildi ✓"
SAVED_FOR = "Yozildi ✓ {child}: {summary} ({when})"
SAVED_BARE_FOR = "Yozildi ✓ ({child})"

WHEN_JUST_NOW = "hozirgina"
WHEN_TODAY_AT = "bugun soat {time} da"
WHEN_DATE_AT = "{date}, soat {time} da"

SUMMARY_KETONES = "Ketonlar {value} mmol/l, {method}"
SUMMARY_WEIGHT = "Vazn {value} kg"
SUMMARY_WELLBEING = "O‘zini his qilish: {symptom}"

KETONE_METHOD_NAMES = {"blood": "qon", "urine": "siydik"}

# --- Ovqat ---

MEAL_ASK = "Bugungi rejadan nimalar allaqachon yeyildi?"
MEAL_NO_MENU = (
    "Bugun uchun menyu tuzilmagan. Yeyilganini so‘z bilan yozishingiz mumkin — "
    "men tahlil qilib, nimani yozishni ko‘rsataman."
)

# --- Ovqat so‘z bilan (раздел 10.3) ---
#
# Разбор идёт по справочнику продуктов на русском (ADR-0052): по-узбекски модель
# понимает, но название, совпадающее со справочником, разбирается надёжнее.
# Это сказано в подсказке, а не обнаруживается по списку «не нашла».
BTN_MEAL_TEXT = "✍️ So‘z bilan yozish"
MEAL_TEXT_ASK = (
    "Bola nimani va qancha yeganini yozing. Masalan: «30 g sariyog‘ va bitta tuxum».\n"
    "Mahsulot nomlarini ruscha yozsangiz, aniqroq tushunaman. Tahlil qilib, nimani "
    "yozishni ko‘rsataman — faqat siz tasdiqlaganingizdan keyin saqlayman."
)
MEAL_TEXT_WORKING = "Tahlil qilyapman…"
MEAL_TEXT_RESULT = "Mana nima chiqdi:\n\n{lines}"
MEAL_TEXT_LINE = "• {name} — {grams} g"
MEAL_TEXT_LINE_GUESS = "• {name} — taxminan {grams} g"
MEAL_TEXT_UNMATCHED = "\n\nMa’lumotnomadan topilmadi: {list}. Bu mahsulotlar hisobga kirmaydi."
MEAL_TEXT_CONFIRM_HINT = "\n\nYozaymi?"
MEAL_TEXT_SAVED = "Yozildi ✓"
MEAL_TEXT_SUMMARY_ITEM = "{name} {grams} g"
MEAL_TEXT_CLARIFY = "{question}\n\nYana bir bor yozing — yoki menyuga qayting."
MEAL_TEXT_EMPTY = "Nimani yozishni tushunmadim. Bola nimani va qancha yeganini yozing."
MEAL_TEXT_LIMIT = (
    "Bugun so‘z bilan tahlil qilish boshqa mavjud emas. Yeyilganini kun rejasi "
    "bo‘yicha belgilang — pastdagi menyuda «🍽 Ovqat» tugmasi."
)
MEAL_TEXT_UNAVAILABLE = (
    "Tahlil hozir mavjud emas. Yeyilganini kun rejasi bo‘yicha belgilang yoki "
    "keyinroq urinib ko‘ring."
)
BTN_CONFIRM = "Tasdiqlash"
MEAL_ALL_EATEN = "Bugungi rejadagi hammasi allaqachon belgilangan ✓"
MEAL_MARKED = "Belgilandi ✓ {title}"
MEAL_MARKED_MORE = "Belgilandi ✓ {title}\n\nBugungi rejada yana:"
MEAL_MARKED_LAST = "Belgilandi ✓ {title}. Bu bugungi rejadagi oxirgisi edi."
MEAL_UNKNOWN_DISH = "Taom"
MEAL_PLAN_CHANGED = "Bugungi reja hozirgina o‘zgartirildi. Unda hozir quyidagilar bor:"
MEAL_PLAN_CHANGED_EMPTY = "Bugungi reja hozirgina o‘zgartirildi — unda belgilanmagan taom yo‘q."
BTN_DONE = "Tayyor"


def meal_name(index: object) -> str:
    """Ovqatlanish raqami: «1-ovqatlanish» (см. `texts_ru.meal_name`)."""

    return MEAL_NAME.format(index=index) if isinstance(index, int) else str(index)


MEAL_NAME = "{index}-ovqatlanish"


# --- Til (ADR-0052) ---
#
# Подпись кнопки и вопрос — те же, что в русском каталоге: двуязычные намеренно.
BTN_LANGUAGE = "🌐 Til / Язык"
LANGUAGE_ASK = "Tilni tanlang · Выберите язык"
LANGUAGE_CHOSEN = "Tayyor: endi o‘zbek tilida yozaman. Ilova ham o‘zbek tilida ochiladi."
CMD_LANGUAGE_DESCRIPTION = "Til / Язык — tilni almashtirish"

# --- Dorilar ---

MEDICATION_ASK = "Qaysi dori berildi?"
MEDICATION_NONE = (
    "Davolash sxemasi hali kiritilmagan. Uni shifokor yuritadi — u dorilarni "
    "kiritishi bilan ular shu yerda paydo bo‘ladi."
)
MEDICATION_DOSE = "{name} — {dose}"

# --- Qachon bo‘lgan ---

WHEN_ASK = "Bu qachon bo‘ldi?"
BTN_WHEN_NOW = "Hozir"
BTN_WHEN_MANUAL = "Vaqtni ko‘rsatish"
WHEN_ASK_MANUAL = (
    "Bugungi voqea vaqtini kiriting, masalan 07:30.\n"
    "Agar oldinroq bo‘lgan bo‘lsa — sana va vaqtni: 29.08 21:00."
)
WHEN_BAD_FORMAT = (
    "Vaqtni tushunib bo‘lmadi. Bugun bo‘lgan bo‘lsa 07:30, oldinroq bo‘lgan "
    "bo‘lsa 29.08 21:00 deb kiriting."
)
WHEN_IN_FUTURE = "Bu vaqt hali kelmagan. Tekshirib ko‘ring — balki allaqachon yozgandirsiz?"
WHEN_TOO_OLD = (
    "Bir haftadan oldingi voqeani yozib bo‘lmaydi: ko‘pincha bu sanadagi xato. "
    "Agar yozuv haqiqatan eski bo‘lsa, uni brauzerdagi kabinetda qo‘shish mumkin — "
    "u ilovaning «Kabinetga kirish» bo‘limida yoqiladi."
)

UNKNOWN_INPUT = (
    "Men ma’lumotlarni yozib boraman. Boshqa savollar uchun ilovani 📱 oching "
    "yoki shifokorga murojaat qiling."
)
UNKNOWN_INPUT_NO_APP = (
    "Men ma’lumotlarni yozib boraman — pastdagi menyudan tugmani tanlang. "
    "Tibbiy savollar bilan shifokorga murojaat qiling."
)

# --- Yordam (/help) ---

HELP = (
    "Bu bot nimalar qila oladi:\n\n"
    "🩸 Ketonlar, ⚖️ Vazn, 🙂 O‘zini his qilish — kundaliklarga tezkor yozuvlar\n"
    "🍽 Ovqat — bugungi rejadan yeyilganini belgilash yoki so‘z bilan yozish\n"
    "💊 Dorilar — shifokor sxemasidagi dori berilganini belgilash\n"
    "{app_line}"
    "💻 Brauzerdagi kabinet — qabul uchun hisobotlar va hujjatlar. Agar u hali "
    "yo‘q bo‘lsa va kerak bo‘lsa, ilovada yoqing: «Kabinetga kirish» bo‘limi\n"
    "🌐 Til / Язык — o‘zbek yoki rus tili\n"
    "\n"
    "Bolani hali ulamadingizmi? Kirish kodini yuboring: uni qabulda shifokor "
    "yoki bolaning ota-onasi beradi.\n"
    "👶 Ikki bola parhezdami? Ikkinchi bolaning kodini ham shu yerga yuboring — "
    "kimning kundaligini yuritishni «Bola» tugmasi bilan almashtirasiz.\n"
    "👨‍👩‍👧 Buvini, ikkinchi ota-onani yoki enagani taklif qilish — ilovada, "
    "«Yaqinlar» bo‘limi.\n"
    "⏰ Eslatmalar — ilovada, bosh sahifadagi «Eslatmalar» bloki.\n"
    "Yozuvda xato qildingizmi? Uni ilovaning «Kundalik» bo‘limida tuzatish yoki "
    "o‘chirish mumkin.\n"
    "Telefonni yo‘qotdingizmi? Sizni taklif qilgan odamdan yoki shifokordan "
    "«Yaqinlar» bo‘limida kirishni yopishni so‘rang — keyin yangi kod bilan qayta "
    "kirasiz.\n\n"
    "Bot tibbiy savollarga javob bermaydi — ular bilan shifokoringizga murojaat qiling."
)
HELP_APP_LINE = (
    "📱 Ilova — umumiy holat, kun rejasi va grafiklar: yozish maydonining chap "
    "tomonidagi «Ilova» tugmasi\n"
)

CMD_START_DESCRIPTION = "Bolani ulash yoki qaytadan boshlash"
CMD_HELP_DESCRIPTION = "Bot nimalar qila oladi"
BOT_DESCRIPTION = (
    "Bolaning kundaliklarini KetoCare’ga yozadi: ketonlar, vazn, ovqat (reja "
    "bo‘yicha yoki o‘z so‘zlaringiz bilan), dorilar va o‘zini his qilish. Ulash "
    "uchun shifokor yoki bolaning ota-onasidan kod kerak."
)
BOT_SHORT_DESCRIPTION = "Bolaning KetoCare kundaliklari — chatdan"

API_UNAVAILABLE = "Saqlab bo‘lmadi — bir daqiqadan keyin yana urinib ko‘ring."

NO_CONNECTION = (
    "Server bilan aloqa yo‘q — yozuv hali saqlanmadi. Hech narsa yo‘qolmadi: "
    "aloqa tiklanganda o‘sha tugmani bosing yoki oxirgi javobni qayta yuboring — "
    "ikkinchi yozuv paydo bo‘lmaydi."
)

# --- Ketonlar (раздел 7.3) ---

KETONES_ASK_VALUE = "Ketonlar qiymatini mmol/l da kiriting, masalan 3,2"
KETONES_ASK_METHOD = "Nima bilan o‘lchandi?"
KETONES_METHOD_BLOOD = "Qon"
KETONES_METHOD_URINE = "Siydik"
KETONES_OUT_OF_RANGE = "Qiymat 0-12 mmol/l oralig‘idan tashqarida. Tekshirib, qaytadan kiriting."
KETONES_NOT_A_NUMBER = "Raqam kerak, masalan 3,2. Yana bir bor urinib ko‘ring."

# --- Vazn (раздел 7.3) ---

WEIGHT_ASK_VALUE = "Vaznni kilogrammda kiriting, masalan 18,4"
WEIGHT_OUT_OF_RANGE = "Qiymat 2-150 kg oralig‘idan tashqarida. Tekshirib, qaytadan kiriting."
WEIGHT_NOT_A_NUMBER = "Raqam kerak, masalan 18,4. Yana bir bor urinib ko‘ring."

# --- O‘zini his qilish (раздел 7.3) ---

WELLBEING_ASK_SYMPTOM = "Nimani sezdingiz? Qisqacha yozing, masalan «holsizlik»."
WELLBEING_ASK_NOTE = "Tavsif qo‘shasizmi? Yozing yoki «O‘tkazib yuborish» tugmasini bosing."
WELLBEING_SKIP = "O‘tkazib yuborish"
WELLBEING_TOO_LONG = "Juda uzun. {limit} belgidan oshirmang."
