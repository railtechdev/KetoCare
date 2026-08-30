/**
 * Узбекская версия словаря (латиница).
 *
 * Структура обязана в точности совпадать со структурой `ru.ts`: тип `Dict`
 * выведен из русского словаря, поэтому пропущенный или лишний ключ ловится
 * `astro check`, а не замечается на живом сайте. Правки формулировок — здесь,
 * а не в разметке.
 */

import type { ChatMsg, Dict, HowStep, Level, QueueItem } from "./ru";

export const uz: Dict = {
  /** Подписи интерфейса, общие для всех страниц. */
  common: {
    brand: "KetoCare",
    /** Буква в квадрате логотипа: у латиницы и кириллицы она разная. */
    brandMark: "K",
    skipToContent: "Asosiy mazmunga o‘tish",
    openMenu: "Menyuni ochish",
    closeMenu: "Menyuni yopish",
    languageLabel: "Sayt tili",
    grams: "g",
    kcal: "kkal",
    fat: "Yog‘lar",
    protein: "Oqsillar",
    carbs: "Uglevodlar",
  },

  nav: {
    howItWorks: "Bu qanday ishlaydi",
    doctors: "Shifokorlarga",
    login: "Kirish",
    earlyAccess: "Erta kirish",
    pilot: "Pilot uchun ariza",
    home: "Bosh sahifa",
  },

  /** Форма заявки — одна на два места (семьям и врачам). */
  leadForm: {
    emailLabel: "Elektron pochta",
    emailPlaceholderFamily: "El. pochta",
    emailPlaceholderDoctor: "Ish pochtasi",
    submitFamily: "Ariza qoldirish",
    submitDoctor: "Yuborish",
    sending: "Yuborilmoqda…",
    errorEmail: "Pochta manzilini tekshiring — unda xatolik bordek.",
    errorNetwork:
      "Arizani yuborib bo‘lmadi. Yana urinib ko‘ring yoki bizga pochtaga yozing.",
    errorRateLimited:
      "Manzilingizdan juda ko‘p ariza yuborildi. Bizga {email} manziliga yozing.",
    doneFamily:
      "Yozib oldik! {email} manziliga yozamiz va ulanishda yordam beramiz.",
    doneDoctor:
      "Ariza qabul qilindi. Yaqin kunlarda {email} manziliga javob beramiz.",
    consent:
      "Arizani yuborish orqali siz ko‘rsatilgan manzil bo‘yicha siz bilan bog‘lanishimizga rozilik bildirasiz. Formada tibbiy ma’lumotlarni yubormang.",
  },

  home: {
    seo: {
      title: "KetoCare — bolalar keto dietasi shifokor nazorati ostida",
      description:
        "Dorilarga chidamli epilepsiyali bolalar keto dietasi: taomlarni tayinlovga moslab hisoblash, oltita kundalik, shifokorga dinamika. Veb va Telegram.",
    },
    hero: {
      badge: "Platforma ishlamoqda va rivojlanmoqda",
      h1: "Bolaning ketogen dietasi — shifokor tayinlovi bo‘yicha aniq",
      lead: "KetoCare dorilarga chidamli epilepsiyali bolalarning oilalariga ketogen dietoterapiyani bajarishda yordam beradi: taomlarni hisoblaydi, kundaliklarni yuritadi va qabullar orasidagi dinamikani shifokorga ko‘rsatadi.",
      ctaFamily: "Oilalar uchun erta kirish",
      ctaDoctors: "Shifokorlar va klinikalarga",
      chips: [
        "Faqat shifokor tayinlovi bo‘yicha",
        "Etalon tekshiruvi bilan hisob",
        "Veb + Telegram",
      ],
      /** Иллюстрация: главный экран кабинета родителя. */
      card: {
        today: "Bugun",
        childName: "Anya · 7 yosh",
        // Не «AI»: на странице, где рядом говорится об ИИ, латинские инициалы
        // читаются как аббревиатура, а не как имя ребёнка.
        childInitials: "AN",
        nextMeal: "Keyingi ovqatlanish · 12:30",
        ratio: "3,50 : 1",
        dish: "Qaymoq va brokkolili omlet",
        dishMacros: "310 kkal · yog‘ 29,4 g · oqsil 6,8 g · uglevod 1,6 g",
        dayVsPrescription: "Kun tayinlovga nisbatan",
        caloriesLabel: "Kaloriya",
        caloriesValue: "742 / 1200 kkal",
        fatValue: "68,2 g",
        proteinValue: "17,1 g",
        carbsValue: "7,7 g",
        carbsLeft: "Bugunga uglevoddan 12 g dan <strong>4,3 g</strong> qoldi",
        quickKetones: "+ Ketonlar",
        quickWeight: "+ Vazn",
        quickSeizure: "Xuruj",
        caption: "Ota-ona kabineti — bosh ekran shunday ko‘rinadi",
      },
    },
    mission: {
      eyebrow: "Missiya",
      h2: "Uyda ham terapiya klinikadagidek aniq bajarilishi uchun",
      lead: "Ketogen dietoterapiya dorilar yordam bermagan bolalarning bir qismiga yordam berishi mumkin — lekin faqat tayinlov aniq bajarilgandagina. Qabullar orasida oila hisob-kitoblar bilan yolg‘iz qoladi. KetoCare oila va shifokorni bitta konturga birlashtiradi: tayinlov, hisob-kitoblar, kundaliklar va dinamika — bitta tizimda.",
      families: {
        title: "Oilalarni nima kutadi",
        items: [
          "Har bir taom tayinlovga moslab hisoblanadi — kalkulyatorsiz va daftarsiz",
          "Kunlik menyu va oltita kundalik — telefondan, bir-ikki marta bosib",
          "Shifokor qabullar orasidagi dinamikani ko‘radi — siz yolg‘iz qolmaysiz",
        ],
      },
      doctors: {
        title: "Shifokorlarni nima kutadi",
        items: [
          "Versiyalari va yo‘l qo‘yiladigan chetlanishlari bilan tayinlovlar — tarix qayta yozilmaydi",
          "Bemorlar ro‘yxati xavf bo‘yicha va dinamikasi bilan bemor kartasi",
          "Qabulga oila yozuvlaridan hisobot — xotira emas, ma’lumot asosidagi suhbat",
        ],
      },
    },
    steps: {
      eyebrow: "Bu qanday tashkil etilgan",
      h2: "Uch rol, bitta kundalik, oshxonada hech qanday arifmetika yo‘q",
      items: [
        {
          title: "Shifokor tayinlov beradi",
          text: "Keto nisbati, kunlik kaloriya, oqsil maqsadi va uglevod chegarasi — hammasi bitta joyda, kuchga kirish sanasi bilan.",
        },
        {
          title: "Oila bajaradi",
          text: "Platforma taom va menyuni tayinlovga moslab hisoblaydi va kun unga mos kelayotgan-kelmayotganini darhol aytadi. Kundaliklar — bir-ikki marta bosib, vebdan yoki Telegramdan.",
        },
        {
          title: "Shifokor dinamikani ko‘radi",
          text: "Ketonlar, vazn, xurujlar va ovqatlanish — bemor kartasida. Qabulga — daftar va xotiradan so‘zlab berish o‘rniga tayyor hisobot.",
        },
      ],
      link: "Har bir qadam haqida batafsil",
    },
    calc: {
      eyebrow: "O‘zingiz sinab ko‘ring",
      h2: "3,5 : 1 tayinloviga mos nonushta yig‘ing",
      lead1:
        "Keto nisbati — bu yog‘larning oqsil va uglevodlar yig‘indisiga nisbati. Har bir taom shifokor tayinloviga yo‘l qo‘yiladigan chetlanish doirasida tushishi kerak.",
      lead2:
        "Slayderlarni suring — hisob bir zumda chiqadi. Hayotda buni platforma bajaradi: har bir ovqatlanishda tarozi-kalkulyator-daftarsiz.",
      note: "Mahsulotlar ma’lumotlari — USDA FoodData Central. Platformada hisobni alohida yadro bajaradi; u texnik topshiriq formulalari bo‘yicha hisoblangan etalon stsenariylarda tekshiriladi. Tibbiy jamoaning tasdig‘i esa hali oldinda.",
      dish: "Qaymoq va brokkolili omlet",
      ingredients: ["Tovuq tuxumi", "Qaymoq 33%", "Sariyog‘", "Brokkoli"],
      /** Видимая оговорка: посетитель не должен считать этим завтрак ребёнку. */
      disclaimer:
        "Bu — formulaning namoyishi, ovqatlanishni rejalashtirish vositasi emas. Bolaning ovqatlanishi kabinetda, shifokorning amaldagi tayinlovi bo‘yicha hisoblanadi.",
      /** Подпись ползунка для читателя с экранного диктора: «Яйцо куриное, граммы». */
      sliderLabel: "{name}, gramm",
      verdictOk: "3,5 : 1 tayinloviga mos keladi (dastlabki chetlanish ±0,15)",
      verdictLow: "Tayinlovdan past — yog‘ qo‘shing yoki uglevodni kamaytiring",
      verdictHigh: "Tayinlovdan yuqori — yog‘ tayinlanganidan ko‘p",
    },
    diaries: {
      eyebrow: "Kundaliklar",
      h2: "Oltita kundalik — bir-ikki marta bosib",
      lead: "Xurujlar, ketonlar, vazn, ovqat, dorilar va o‘zini his qilish. Oila yozgan hamma narsa — vebdan, botdan yoki mini-ilovadan — bitta kundalikka tushadi va shifokorga ko‘rinadi.",
      ketones: {
        title: "14 kun ichidagi ketonlar",
        badge: "3,5 mmol/l",
        caption: "Ketozga chiqish grafikda ko‘rinadi, «tuyg‘u bo‘yicha» emas",
        chartAlt:
          "14 kunlik ketonlar grafigi: qiymat 1,2 dan 3,5 mmol/l gacha bir tekis o‘sadi.",
      },
      seizure: {
        title: "Xuruj — darhol, tafsilotlari — keyin",
        text: "Xuruj paytida hech kim shakl to‘ldirmaydi. Yozuv bir-ikki marta bosish bilan qilinadi: turi va «hozir». Sabab-omillar va tavsifni hammasi tinchiganda keyinroq qo‘shsa bo‘ladi. Shifokor uchun yozuvlar xuruj turlari bo‘yicha odatiy oylik jadvalga o‘zi yig‘iladi.",
        chipType: "Toniko-klonik",
        chipNow: "Hozir",
      },
      progress: {
        title: "Progress — bu «qoldi», «yeyildi» emas",
        text: "«Bugunga uglevoddan 4,3 g qoldi» — bu javob, arifmetika masalasi emas. Ogohlantirish faqat tayinlovdan haqiqiy chetlanish bo‘lgandagina paydo bo‘ladi.",
      },
    },
    telegram: {
      eyebrow: "Telegram",
      h2: "Yozuv — to‘g‘ridan-to‘g‘ri messenjerdan",
      lead: "Keton o‘lchovi — botga bitta xabar. Bot va mini-ilova — platformaning bir qismi: hammasi o‘sha kundalikka tushadi va shifokorga ko‘rinadi. Bot bosqichma-bosqich chiqarilmoqda, shuning uchun quyidagi stsenariylarning bir qismi allaqachon ishlaydi, bir qismi esa tayyorlanmoqda.",
      items: [
        "Ketonlar, vazn va o‘zini his qilish — tugmalar bilan 2–4 marta bosib",
        "Tayyorlanmoqda: ovqat erkin matn bilan — sun’iy intellekt tahlil qiladi, siz tasdiqlaysiz",
        "Tayyorlanmoqda: o‘lchovlar va dorilar haqida eslatmalar",
        "Tayyorlanmoqda: ota-ona kabineti Telegram ichidagi mini-ilova sifatida",
      ],
      botLabel: "bot",
      replay: "Yana bir bor",
      caption:
        "Stsenariy namoyishi. Bot terapiya bo‘yicha maslahat bermaydi — faqat tez yozuvlar va eslatmalar",
      chat: [
        { from: "user", text: "ketonlar 2,6", time: "08:11" },
        {
          from: "bot",
          text: "Ketonlar 2,6 mmol/l. Qaysi usulda o‘lchadingiz?",
          time: "08:11",
          chips: ["Qon", "Siydik"],
        },
        { from: "user", text: "Qon", time: "08:12" },
        {
          from: "bot",
          text: "Yozildi ✓ Ketonlar 2,6 mmol/l (qon), bugun soat 08:12 da. Kundalikda yozuv bor — shifokor ko‘radi.",
          time: "08:12",
        },
        { from: "user", text: "vazn 21,4", time: "14:05" },
        {
          from: "bot",
          text: "Vazn 21,4 kg. Bugunga yozib qo‘yaymi?",
          time: "14:05",
          chips: ["Ha, bugunga", "Boshqa sana"],
        },
        { from: "user", text: "Ha, bugunga", time: "14:05" },
        {
          from: "bot",
          text: "Yozildi ✓ Vazn 21,4 kg, bugun. Dinamikani shifokor kartada ko‘radi.",
          time: "14:06",
        },
      ] as ChatMsg[],
    },
    doctorsTeaser: {
      eyebrow: "Shifokorlar va dietologlarga",
      h2: "«Nechta bemor» emas, bugun kim bilan shug‘ullanish kerakligi",
      lead: "Bemorlar ro‘yxati xavf bo‘yicha saralangan: oilaning jim qolishi, ovqatlanishning chetlanish chegarasidan chiqishi, xurujlarning haftadan haftaga ko‘payishi. Dinamika va kundaliklar — bemor kartasida, qabulga hisobot oila yozuvlaridan shakllanadi.",
      cta: "Shifokor kabineti haqida batafsil",
      queueTitle: "E’tibor navbati",
      queue: [
        {
          name: "Misha K.",
          status: "ma’lumot yo‘q",
          reason: "Kundalik yozuvlari 4 kundan beri yo‘q",
          age: "4 kun oldin",
          level: "danger",
        },
        {
          name: "Anya I.",
          status: "ovqatlanish",
          reason:
            "Kun ketma-ket uchinchi kun chetlanish chegarasidan chiqmoqda",
          age: "ma’lumot bugungi",
          level: "warning",
        },
        {
          name: "Vera S.",
          status: "xurujlar",
          reason: "Xurujlar o‘tgan haftadagidan ko‘p",
          age: "ma’lumot kechagi",
          level: "warning",
        },
      ] as QueueItem[],
      queueNote:
        "Holat doimo so‘z bilan ham takrorlanadi — rang yagona signal emas",
    },
    trust: {
      eyebrow: "Nega bunga ishonish mumkin",
      h2: "Hisob xatosi — klinik xavf. Biz shundan kelib chiqib loyihalaymiz.",
      items: [
        {
          title: "Hisob etalonlar bilan tekshirilgan",
          text: "Hisob yadrosi qolgan koddan ajratilgan va har bir o‘zgarishda etalon stsenariylar to‘plami bilan solishtiriladi. Etalonlarning o‘zi esa texnik topshiriq formulalari bo‘yicha hisoblangan va tibbiy jamoaning tasdig‘ini kutmoqda.",
        },
        {
          title: "Rollar bo‘yicha kirish",
          text: "Ota-ona o‘z bolasini, shifokor o‘z bemorlarini ko‘radi. Kirish ikki bosqichli himoya bilan, ma’lumotlar ustidagi amallar audit jurnalida qayd etiladi.",
        },
        {
          title: "Sun’iy intellekt odam o‘rniga qaror qilmaydi",
          text: "Sun’iy intellekt yordamchisi keyingi bosqichda paydo bo‘ladi va u allaqachon shunday loyihalangan: erkin matnni tahlil qiladi hamda xulosa qoralamalarini tayyorlaydi, lekin har bir yozuvni odam tasdiqlaydi, so‘rovlarga esa na ismlar, na aloqa ma’lumotlari tushadi.",
        },
        {
          title: "Kanallar — tanlovingizga ko‘ra",
          text: "Veb-kabinet, Telegram-bot va mini-ilova bitta kundalikka yozadi. Oila bugun qaysi biri qulay bo‘lsa, o‘shani tanlaydi.",
        },
      ],
    },
    faq: {
      h2: "Ko‘p beriladigan savollar",
      items: [
        {
          q: "KetoCare bizga to‘g‘ri keladimi?",
          a: "Platforma shifokor ketogen dietoterapiya tayinlagan oilalar uchun yaratilgan — odatda bu dorilarga chidamli epilepsiyali bolalar. Dietani shifokorsiz boshlash mumkin emas va platforma buni taklif ham qilmaydi.",
        },
        {
          q: "Bu shifokor yoki dietolog o‘rnini bosadimi?",
          a: "Yo‘q. Tayinlovni faqat davolovchi jamoa beradi va o‘zgartiradi. KetoCare uni uyda aniq bajarishga yordam beradi va shifokorni qabullar orasidagi dinamikadan xabardor qilib turadi.",
        },
        {
          q: "Bu qancha turadi?",
          a: "Platforma birinchi oilalar va klinikalar bilan birga rivojlanmoqda; shartlarni har bir holat uchun alohida muhokama qilamiz — aloqa ma’lumotingizni qoldiring, hammasini tushuntiramiz.",
        },
        {
          q: "Boshlash uchun nima kerak?",
          a: "Davolovchi shifokorning taklifnomasi: qabulda u havola beradi, siz u orqali bolaning profilini yaratasiz va qisqa anketani to‘ldirasiz — har bir ekranda bitta savol. Agar shifokoringiz hali KetoCare bilan ishlamasa, aloqa ma’lumotingizni qoldiring — uni platforma bilan tanishtirishga yordam beramiz.",
        },
        {
          q: "Ikkala ota-ona ham yozib bora oladimi?",
          a: "Ha. Bolada bir nechta kattalar bo‘lishi mumkin — ikki ota-ona, buvi, vasiy — va har biri o‘z hisobidan kundalik yuritadi. Bitta ota-ona bir nechta bolani ham olib borishi mumkin.",
        },
        {
          q: "Bolaning ma’lumotlari qayerda saqlanadi?",
          a: "Kirish qat’iy rollar bo‘yicha: ota-ona o‘z bolasini, shifokor o‘z bemorlarini ko‘radi, tizim administratorining esa klinik ma’lumotlarga kirishi umuman yo‘q. Kirish ikkinchi omil bilan himoyalangan, ma’lumotlar bilan bajarilgan amallar jurnalga yoziladi. Oilaning so‘roviga ko‘ra ma’lumotlar to‘liq o‘chiriladi.",
        },
      ],
    },
    cta: {
      h2: "Tanishuvni boshlaymiz",
      lead: "Platforma allaqachon ishlaydi va rivojlanishda davom etmoqda. Oilaga kirishni davolovchi shifokor ochadi; shifokorlar va klinikalarni to‘g‘ridan-to‘g‘ri ulaymiz.",
      family: {
        eyebrow: "Oilalarga",
        title: "Sizning oilangiz uchun kirish",
        text: "Oilaga kirishni davolovchi shifokor ochadi — qabulda taklifnoma berish orqali. Agar shifokoringiz hali biz bilan bo‘lmasa, pochtangizni qoldiring: uni platforma bilan tanishtirishga yordam beramiz.",
      },
      doctors: {
        eyebrow: "Shifokorlar va klinikalarga",
        title: "Pilot uchun ariza",
        text: "Shifokor kabinetini ko‘rsatamiz, klinikangiz protokollarini muhokama qilamiz va birinchi bemorlarni siz bilan birga ulaymiz.",
        cta: "Batafsil va ariza",
      },
    },
  },

  howItWorks: {
    seo: {
      title: "KetoCare qanday ishlaydi — tayinlovdan hisobotgacha",
      description:
        "KetoCare’da keto dietaning besh qadami: shifokor tayinlov beradi, oila menyu yig‘adi va kundalik yuritadi, shifokor dinamikani ko‘radi. Veb, bot, mini-ilova.",
    },
    hero: {
      eyebrow: "Bu qanday ishlaydi",
      h1: "Tayinlovdan hisobotgacha — bitta kontur",
      lead: "Shifokor, oila va ma’lumotlar bitta tizimda ishlaydi. Hech narsa daftardan ko‘chirilmaydi, kalkulyatorda qayta hisoblanmaydi va qabullar orasida yo‘qolmaydi.",
    },
    steps: [
      {
        role: "Shifokor",
        title: "Oilani taklif qiladi va tayinlov beradi",
        paragraphs: [
          "Oilaga kirishni davolovchi shifokor ochadi: qabulda taklif havolasini beradi. U orqali ota-ona bolaning profilini yaratadi va qisqa anketani to‘ldiradi — har bir ekranda bitta savol; tashxis va preparatlarning aniq ro‘yxatini shifokor kiritadi.",
          "Keyin — tayinlov: keto nisbati, kunlik kaloriya, oqsil maqsadi va uglevod chegarasi, kuchga kirish sanasi bilan. Har bir o‘zgarish — yangi versiya, tarix to‘liq saqlanadi.",
        ],
        chips: ["3,5 : 1", "1200 kkal/kun", "oqsil 25 g", "uglevod ≤ 12 g"],
      },
      {
        role: "Oila",
        title: "Menyuni arifmetikasiz yig‘adi",
        paragraphs: [
          "Ota-ona mahsulot va grammlarni tanlaydi — platforma bir zumda kaloriya, oqsil, yog‘, uglevod va nisbatni hisoblaydi hamda taom tayinlovga tushayotgan-tushmayotganini aytadi. Ovqatni kiritish bo‘sh qidiruvdan emas, «So‘nggilar» va «Tez-tez ishlatiladiganlar» ro‘yxatidan boshlanadi.",
        ],
        verdictBadge: "3,52 : 1",
        verdictText: "Tayinlovga mos keladi · dastlabki chetlanish ±0,15",
        chips: [],
      },
      {
        role: "Oila",
        title: "Kundaliklarni bir-ikki marta bosib yuritadi",
        paragraphs: [
          "Xurujlar, ketonlar, vazn, ovqat, dorilar va o‘zini his qilish — vebdan yoki Telegram-botga qisqa xabar bilan. Ovqatni erkin matn bilan tasvirlash mumkin: sun’iy intellekt tarkibni tahlil qiladi, siz esa tasdiqlaysiz. Xuruj darhol bir-ikki marta bosish bilan qayd etiladi: turi va «hozir», tafsilotlari — keyinroq. Xuruj paytida hech kim shakl to‘ldirmaydi.",
        ],
        chips: ["+ Ketonlar", "+ Vazn", "+ Dori", "Xuruj — hozir"],
      },
      {
        role: "Shifokor",
        title: "Qabullar orasidagi dinamikani ko‘radi",
        paragraphs: [
          "Ketonlar, vazn, xurujlar va ovqatlanish — tayinlov o‘zgarishi belgilari bilan bitta vaqt shkalasida. E’tibor talab qiladigan bemorlar ro‘yxatning yuqorisiga o‘zi ko‘tariladi: oilaning jim qolishi, chetlanish chegarasidan chiqish, xurujlarning haftadan haftaga ko‘payishi.",
        ],
        chips: [],
      },
      {
        role: "Birgalikda",
        title: "Qabul xotira bo‘yicha emas, ma’lumot bo‘yicha o‘tadi",
        paragraphs: [
          "Tashrifga davr bo‘yicha xulosa tayyor bo‘ladi: ko‘rsatkichlar dinamikasi, xurujlar, tayinlovga rioya qilish. Suhbat faktlardan boshlanadi, tuzatish haqidagi qarorni shifokor qabul qiladi.",
        ],
        chips: [],
      },
    ] as HowStep[],
    channels: {
      h2: "Bitta kundalik, to‘rtta kanal",
      lead: "Oila qayerga yozmasin — ma’lumot bitta joyga tushadi va shifokorga ko‘rinadi.",
      items: [
        {
          title: "Veb-kabinet",
          text: "Ota-ona, shifokor, dietolog va administrator kabinetlari. Menyu, kundaliklar, bemor kartasi, hisobotlar.",
        },
        {
          title: "Telegram-bot",
          text: "Kundalik yozuvlarini qisqa xabarlar bilan tez kiritish va o‘lchovlar haqida eslatmalar.",
        },
        {
          title: "Mini-ilova",
          text: "Telegram ichidagi ota-ona kabineti — alohida ilova o‘rnatmasdan.",
        },
        {
          title: "Sun’iy intellekt yordamchisi",
          text: "Erkin matnni tahlil qiladi («omlet va yarim stakan qaymoq yedik») va xulosa qoralamalarini tayyorlaydi. Har bir yozuvni odam tasdiqlaydi. Terapiya bo‘yicha maslahat bermaydi — bunday savollarni shifokorga yo‘naltiradi.",
        },
      ],
    },
    status: {
      eyebrow: "Loyiha holati",
      h2: "Asosiy funksiyalar allaqachon ishlaydi",
      nowTitle: "Bugun ishlaydi",
      now: [
        "Ota-ona, shifokor va administrator kabinetlari",
        "Etalon testlari bilan hisob yadrosi",
        "Tayinlovlar, mahsulotlar bazasi, menyu va oltita kundalik",
        "2FA bilan kirish, kirish rollari, audit jurnali",
      ],
      nextTitle: "Rivojlanishda",
      next: [
        "Telegram-bot va eslatmalar",
        "Telegram ichidagi mini-ilova",
        "Oila uchun sun’iy intellekt yordamchisi va xulosa qoralamalari",
      ],
      note: "Ochiq ro‘yxatdan o‘tish ataylab yo‘q: oilaga kirishni davolovchi shifokor ochadi, shifokorlar va klinikalarni to‘g‘ridan-to‘g‘ri ulaymiz.",
    },
    cta: {
      h2: "O‘z holatingizda ko‘rib chiqing",
      lead: "Oilalarga — erta kirish uchun kutish ro‘yxati. Shifokorlar va klinikalarga — kabinet namoyishi bilan pilot.",
    },
  },

  doctors: {
    seo: {
      title: "KetoCare shifokorlarga — keto dietani nazorat qilish",
      description:
        "KetoCare shifokor kabineti: bemorlar ro‘yxati xavf bo‘yicha, ketonlar, vazn va xurujlar dinamikasi, qabulga hisobot. Klinika uchun pilot arizasi.",
    },
    hero: {
      eyebrow: "Shifokorlar va dietologlarga",
      h1: "Tayinlov bajarilmoqda. Va siz buni ko‘rib turasiz.",
      lead: "Qabullar orasida oila yolg‘iz qoladi: tortadi, hisoblaydi, daftarga yozadi. KetoCare tayinlovning bajarilishini nazorat qilinadigan konturga ko‘chiradi — siz uch oyda bir marta xotiradan so‘zlab berishni emas, dinamika va chetlanishlarni ko‘rasiz.",
      ctaPilot: "Pilot uchun ariza",
      ctaHow: "Kontur qanday tuzilgan",
      card: {
        title: "Tayinlov · Anya I.",
        badge: "16.08 dan faol",
        ratioLabel: "Nisbat",
        ratioValue: "3,5 : 1",
        caloriesLabel: "Kaloriya",
        caloriesValue: "1200 kkal",
        proteinLabel: "Oqsil",
        proteinValue: "25 g/kun",
        carbsLabel: "Uglevodlar",
        carbsValue: "≤ 12 g/kun",
        mealsLabel: "Kuniga ovqatlanish soni",
        mealsValue: "4",
        note: "Oila bu maqsadlarni o‘z kabinetida ko‘radi; har bir taom va kun ular bilan avtomatik solishtiriladi, nisbat bo‘yicha yo‘l qo‘yiladigan chetlanish esa hozircha dastlabki — ±0,15 — va tibbiy jamoa bilan birga aniqlashtirilmoqda.",
      },
    },
    benefits: {
      h2: "Ko‘rsatkichlar vitrinasi emas, ish kuni",
      queue: {
        title: "E’tibor navbati",
        text: "Bemorlar ro‘yxati alifbo bo‘yicha emas, xavf bo‘yicha saralangan: oilaning jim qolishi, ovqatlanishning chetlanish chegarasidan chiqishi, xurujlarning haftadan haftaga ko‘payishi. Qatorda — ism, holat so‘z va rang bilan, sabab, ma’lumotning eskiligi.",
        rows: [
          {
            name: "Misha K.",
            reason: "kundalik yozuvlari 4 kundan beri yo‘q",
            level: "danger",
          },
          {
            name: "Anya I.",
            reason: "kun ketma-ket 3-kun chetlanish chegarasidan chiqmoqda",
            level: "warning",
          },
        ] as { name: string; reason: string; level: Level }[],
      },
      chart: {
        title: "Bemor kartasi",
        text: "Ketonlar, vazn, xurujlar, ovqatlanish va dorilar — tayinlov o‘zgarishi belgilari bilan bitta vaqt shkalasida: tuzatishdan keyin nima o‘zgarganini ko‘rish mumkin.",
        legend: "tayinlov o‘zgarishi 3,0 → 3,5",
        chartAlt:
          "Davr bo‘yicha ko‘rsatkich grafigi: sekin o‘sish, tayinlov o‘zgarishi belgisidan keyin ko‘tarilish sezilarli darajada tikroq bo‘ladi.",
      },
      report: {
        title: "Qabulga hisobot",
        text: "Tashriflar orasidagi davr xulosasi oila yozuvlaridan shakllanadi: dinamika, xurujlar, tayinlovga rioya qilish. Qoralamani sun’iy intellekt shaxssizlantirilgan ma’lumotlar bo‘yicha tayyorlaydi — ism va aloqa ma’lumotlarisiz; hisobotga faqat shifokor tasdiqlagan matn tushadi. Eksport — PDF va CSV.",
        sampleTitle: "Xulosa · 16.08 — 30.08",
        sampleLines: [
          "Ketonlar: mediana 2,8 mmol/l · Vazn: −0,3 kg",
          "Xurujlar: 4 ta (o‘tgan davrda 7 ta edi)",
          "Nisbat bo‘yicha chetlanish doirasidagi kunlar: 14 tadan 11 tasi",
        ],
      },
      grid: {
        title: "Xurujlar — odatiy jadvalda",
        text: "Oila har bir xurujni alohida yozadi — vaqti va davomiyligi bilan. Siz uchun yozuvlar qog‘oz kundalikdagidek «turi × kun qismi» oylik jadvaliga o‘zi yig‘iladi.",
        colType: "Turi",
        colMorning: "Ertalab",
        colDay: "Kunduzi",
        colEvening: "Kechqurun",
        colNight: "Kechasi",
        rows: [
          { type: "TK", values: ["1", "·", "·", "1"] },
          { type: "MK", values: ["·", "2", "·", "·"] },
          { type: "AB", values: ["·", "·", "1", "·"] },
        ],
        caption:
          "Xurujlar jadvali: qatorlarda xuruj turi, ustunlarda kun qismi.",
      },
    },
    rigor: {
      eyebrow: "Klinik qat’iylik",
      h2: "Hisob — ijod uchun joy emas",
      items: [
        {
          title: "Alohida hisob yadrosi",
          text: "Kaloriya, oqsil, yog‘, uglevod va nisbat hisobini interfeys hamda API bilan aralashmagan alohida modul bajaradi. Uni qo‘shni koddan «tezda tuzatib» bo‘lmaydi.",
        },
        {
          title: "Etalon stsenariylar",
          text: "Yadro to‘liq test qamrovi talabi bilan etalon stsenariylar to‘plamiga solishtiriladi; etalondan chetga chiqish — reliz uchun to‘xtash. Hozircha etalonlar texnik topshiriq formulalari bo‘yicha hisoblangan va biz ularni sizning klinikangiz bilan kelishamiz.",
        },
        {
          title: "Rollar, 2FA, audit jurnali",
          text: "Kirish rollar bo‘yicha: shifokor o‘z bemorlarini, ota-ona o‘z bolasini ko‘radi. Kirish ikkinchi omil bilan, ma’lumotlar ustidagi amallar qayd etiladi.",
        },
        {
          title: "Manbasi kuzatiladigan mahsulotlar bazasi",
          text: "Har bir mahsulotda ma’lumot manbai va versiyasi (masalan, USDA FoodData Central) hamda tasdiqlangan sana bor. Hisob «internetning qayeridandir olingan» raqamlarga tayanmaydi.",
        },
        {
          title: "Tayinlovlar qayta yozilmaydi",
          text: "Har bir o‘zgarish — muallifi va amal qilish sanasi bilan yangi versiya; tarix to‘liq saqlanadi. Faol tayinlovni sezdirmay almashtirib bo‘lmaydi.",
        },
      ],
    },
    onboarding: {
      h2: "Oilaga kirishni siz ochasiz",
      lead: "Mustaqil ro‘yxatdan o‘tish yo‘q: oila KetoCare’ga davolovchi shifokor yoki dietolog taklifi bilan kiradi — har bir bemorda birinchi kundan yetakchi mutaxassis bo‘ladi.",
      items: [
        {
          title: "Qabulda taklifnoma",
          text: "Taklif havolasini oilaga to‘g‘ridan-to‘g‘ri qabulda berasiz — pochta va tarqatmalar kerak emas.",
        },
        {
          title: "Oila bolaning profilini yaratadi",
          text: "Qisqa anketa-usta: har bir ekranda bitta savol. Tashxis va preparatlarning aniq ro‘yxatini siz kiritasiz — shunda obyektivroq bo‘ladi.",
        },
        {
          title: "Bemor — sizning ro‘yxatingizda",
          text: "Kundaliklar va menyu darhol ko‘rinadi. Ikkinchi fikr uchun hamkasbni yoki dietologni yetakchi mutaxassis ulaydi.",
        },
      ],
    },
    pilot: {
      h2: "Pilot qanday o‘tadi",
      items: [
        {
          title: "Kabinet bilan tanishuv",
          text: "Shifokor va ota-ona kabinetini demo-ma’lumotlarda ko‘rsatamiz, hisob-kitoblar va chetlanish chegaralari haqidagi savollarga javob beramiz.",
        },
        {
          title: "Sizning protokollaringiz bilan solishtirish",
          text: "Tayinlash va nazorat qilish stsenariylaringizni ko‘rib chiqamiz; zarur bo‘lsa, ular hisob yadrosining etalon testlariga aylanadi.",
        },
        {
          title: "Birinchi oilalar — birgalikda",
          text: "Birinchi bemorlarni sizning kuzatuvingizda ulaymiz, fikr-mulohazalarni yig‘amiz va aynan sizga xalaqit berayotgan narsalarni takomillashtiramiz.",
        },
      ],
    },
    ctaForm: {
      h2: "Pilot uchun ariza",
      lead: "Ish pochtangizni qoldiring — bog‘lanamiz, kabinetni ko‘rsatamiz va klinikangiz yoki amaliyotingiz uchun pilot formatini muhokama qilamiz.",
      direct: "Yoki to‘g‘ridan-to‘g‘ri yozing:",
    },
  },

  footer: {
    disclaimer:
      "KetoCare — shifokor tayinlagan terapiyani olib borishga yordam beruvchi vosita. Shifokor maslahati o‘rnini bosmaydi: ketogen dietoterapiya faqat davolovchi jamoa tomonidan boshlanadi va tuzatiladi.",
    sectionsTitle: "Bo‘limlar",
    contactsTitle: "Aloqa",
    telegram: "Telegram",
    copyright: "© {year} «RailTech» MChJ",
  },
};
