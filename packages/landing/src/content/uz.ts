import type { Dict } from "./ru";

/**
 * O‘zbekcha (lotin yozuvi). Tuzilma `ru.ts` bilan kalitma-kalit bir xil;
 * yetishmayotgan kalit — tur xatosi. Atamalar Telegramdagi ilova va bot
 * bilan bir xil: «tayinlov», «menyu», «kundalik», «kirish kodi»,
 * «yordamchi». Shifokor kabineti rus tilida, shuning uchun uning
 * suratlari ostida bu aytilgan. Matnlarni ishga tushirishdan oldin ona tili
 * o‘zbek tili bo‘lgan kishi o‘qib chiqadi (ADR-0052).
 */
export const uz: Dict = {
  common: {
    brand: "KetoCare",
    brandMark: "K",
    skipToContent: "Asosiy qismga o‘tish",
    openMenu: "Menyu",
    closeMenu: "Yopish",
    mainNav: "Asosiy bo‘limlar",
    languageLabel: "Sayt tili",
    toggleTheme: "Tungi rejim",
    grams: "g",
    kcal: "kkal",
    fat: "Yog‘lar",
    protein: "Oqsillar",
    carbs: "Uglevodlar",
  },

  nav: {
    home: "Bosh sahifa",
    doctors: "Shifokorlarga",
    families: "Oilalarga",
    howItWorks: "Qanday ishlaydi",
    methodology: "Hisob va xavfsizlik",
    login: "Kirish",
    enterCode: "Kirish kodini kiritish",
    lead: "Ariza qoldirish",
  },

  shots: {
    overview: {
      alt: "Shifokor kabineti, bemor sharhi: bugungi kun yakunlari — keto nisbati 3,5 : 1, 1 300 kkal dan 1 303 kkal, uglevodlar 14 g dan 11,4 g; o‘ngda tayinlov.",
      caption: "Shifokor kabineti (rus tilida): bolaning kuni tayinlov yonida",
    },
    patients: {
      alt: "Shifokor kabineti, bemorlar ro‘yxati: tepada «Uzoq davom etgan xuruj», «Tayinlov hali yo‘q», «5 kun o‘lchov yo‘q» belgilari va «Oilaga Telegramda eslatish» tugmasi bor bolalar, pastda — «Izoh yo‘q».",
      caption: "Bemorlar ro‘yxati (rus tilida): avval e’tibor kerak bo‘lganlar",
    },
    prescription: {
      alt: "Shifokor kabineti, tayinlov shakli: ro‘yxatdan keto nisbati, yosh va vaznga ko‘ra maslahatli kaloriya, oqsil, uglevodlar, ovqatlanishlar soni, suyuqlik; o‘ngda tayinlovlar tarixi.",
      caption:
        "Tayinlov (rus tilida): yosh va vaznga ko‘ra maslahat, tayinlovlar tarixi",
    },
    menu: {
      alt: "Shifokor kabineti, haftalik menyu: kuniga to‘rt ovqatlanish, har kun ostida keto nisbati va kaloriya.",
      caption: "Haftalik menyu (rus tilida), har kun yakuni bilan",
    },
    ketones: {
      alt: "Shifokor kabineti, ketonlar kundaligi: bir oylik grafik, ketonlar 0,8 dan 3,1 mmol/l gacha ko‘tariladi.",
      caption: "Bir oylik ketonlar kundaligi (rus tilida)",
    },
    seizures: {
      alt: "Shifokor kabineti, xurujlar kundaligi: kunlar va sutka qismlari — ertalab, kunduzi, kechqurun, tunda — bo‘yicha xurujlar soni jadvali.",
      caption: "Kunlar va sutka qismlari bo‘yicha xurujlar (rus tilida)",
    },
    growth: {
      alt: "Shifokor kabineti, bo‘y va vazn: JSST me’yorlariga nisbatan holat va o‘lchovlar jadvali.",
      caption: "JSST me’yorlariga nisbatan bo‘y va vazn (rus tilida)",
    },
    appHome: {
      alt: "Telegramdagi ilova, oilaning bosh ekrani: tayinlov 3,5 : 1 va 1 300 kkal, bugungi kun yakunlari, oxirgi o‘lchovlar.",
      caption: "Telegramdagi ilova: bosh ekran",
    },
    appMenu: {
      alt: "Telegramdagi ilova, bugungi menyu: 1-ovqatlanish — ismaloqli omlet, «Nimani tortish kerak» ro‘yxati ochiq: tuxum 53 g, qaymoq 20 g, sariyog‘ 24 g, ismaloq 10 g; dastlabki ikki ovqatlanish yeyilgan deb belgilangan.",
      caption: "Bugungi menyu: nimani tortish kerak va nima yeyildi",
    },
    appDiary: {
      alt: "Telegramdagi ilova, kundalik: «Yozuv qo‘shish» tugmasi, 30 kunlik ketonlar va vazn grafiklari.",
      caption: "Kundalik: 30 kunlik grafiklar",
    },
  },

  leadForm: {
    emailLabel: "Elektron pochta",
    emailPlaceholder: "name@example.com",
    audienceLegend: "Siz kimsiz",
    audienceDoctor: "Shifokor yoki klinika",
    audienceFamily: "Oila",
    submit: "Arizani yuborish",
    sending: "Yuborilmoqda…",
    errorEmail: "Pochta manzilini tekshiring — unda xato borga o‘xshaydi.",
    errorNetwork:
      "Arizani yuborib bo‘lmadi. Yana urinib ko‘ring yoki {email} manziliga yozing.",
    errorRateLimited:
      "Manzilingizdan allaqachon ko‘p ariza kelgan. Bizga {email} manziliga yozing.",
    doneTitle: "Ariza yuborildi",
    doneText: "Uni KetoCare administratori oladi. Javob uchun manzil: {email}.",
    again: "Boshqa manzil ko‘rsatish",
    consent:
      "Manzil faqat arizaga javob berish uchun kerak. Formada bolaning sog‘lig‘i haqida hech narsa yozmang.",
  },

  home: {
    seo: {
      title:
        "KetoCare — epilepsiyali bolaning ketogen parhezi: shifokor va oila",
      description:
        "Shifokor tayinlovni belgilaydi, oila grammlab ovqat tayyorlaydi va Telegramda kundalik yuritadi, shifokor davolash qanday borayotganini ko‘radi. Kabinet va Telegramdagi ilova.",
    },
    hero: {
      h1: "Epilepsiyali bolaning ketogen parhezi: shifokor va oila bitta tizimda",
      lead: "Shifokor tayinlovni belgilaydi. Oila grammlab ovqat tayyorlaydi va kundalikni telefonda yuritadi. Shifokor davolash qanday borayotganini ko‘radi — daftarlarsiz va qo‘lda qayta hisoblashsiz.",
      ctaPrimary: "Ariza qoldirish",
      ctaSecondary: "Qanday ishlaydi",
      codeHint: "Shifokor sizga kirish kodini berdimi?",
    },
    doctor: {
      h2: "Shifokor nima oladi",
      items: [
        "Bir daqiqada tayinlov — yosh va vaznga ko‘ra kaloriya bo‘yicha maslahat bilan.",
        "Bemorlar ro‘yxati: birinchi bo‘lib e’tibor kerak bo‘lganlar turadi.",
        "Grafikli oila kundaliklari: xurujlar, ketonlar, vazn, o‘zini his qilish, dorilar, ovqatlanish.",
        "JSST me’yorlari bo‘yicha o‘sish, nazorat tashriflari, PDF hisobot.",
        "Oila uchun tayinlov va menyuni chop etish.",
      ],
      more: "Shifokorlar uchun batafsil",
    },
    family: {
      h2: "Oila nima oladi",
      items: [
        "Kunlik menyu: har bir mahsulotdan necha gramm tortish kerak.",
        "Taomni bolaning tayinlovi bo‘yicha tekshirish va grammlarni maqsadga moslash.",
        "Telegramda bir-ikki bosishda kundalik va eslatmalar.",
        "Ilova ishi haqidagi savollarga javob beradigan yordamchi.",
        "Ikkinchi ota-ona yoki buvi uchun kirish. Rus va o‘zbek tillari.",
      ],
      more: "Oilalar uchun batafsil",
    },
    steps: {
      h2: "Qanday ishlaydi",
      items: [
        {
          title: "Shifokor karta ochadi",
          text: "Va tayinlovni belgilaydi: keto nisbati, kaloriya, oqsil, uglevodlar, ovqatlanishlar soni.",
        },
        {
          title: "Oila kod oladi",
          text: "Sakkiz belgi yoki QR-kod. Kod KetoCare Telegram-botida ochiladi, parol kerak emas.",
        },
        {
          title: "Oila uyda davolashni olib boradi",
          text: "Menyu tuzadi, grammlab tortadi, yeyilganini belgilaydi, kundalik yuritadi.",
        },
        {
          title: "Shifokor o‘zgarishlarni ko‘radi",
          text: "Faqat qabulda emas, har kuni. Yangi tayinlovni oila darhol ko‘radi.",
        },
      ],
      more: "Har bir qadam haqida batafsil",
    },
    safety: {
      h2: "Xavfsizlik",
      items: [
        {
          title: "Shifokor hal qiladi",
          text: "Tayinlovni faqat shifokor belgilaydi. Ilova uni o‘zgartirmaydi va shifokor o‘rniga maslahat bermaydi.",
        },
        {
          title: "Har bir taom tekshiriladi",
          text: "Taom va butun kun tayinlov bilan solishtiriladi.",
        },
        {
          title: "Yordamchi davolamaydi",
          text: "Faqat ilova ishi haqida javob beradi. Sog‘liq haqidagi savollar — shifokorga.",
        },
        {
          title: "Rollar bo‘yicha kirish",
          text: "Oila o‘z bolasini, shifokor o‘z bemorlarini ko‘radi. Administrator tibbiy ma’lumotlarni ko‘rmaydi.",
        },
      ],
      more: "Taomlar qanday hisoblanadi va ma’lumotlar qanday himoyalanadi",
    },
    faq: {
      h2: "Ko‘p beriladigan savollar",
      items: [
        {
          q: "Shifokorsiz foydalansa bo‘ladimi?",
          a: "Yo‘q. Tayinlovni shifokor belgilaydi, usiz ilova hech narsani hisoblay olmaydi. Agar shifokoringiz hali KetoCare’da ishlamasa, ariza qoldiring yoki unga tizim haqida aytib bering.",
        },
        {
          q: "Boshlash uchun oilaga nima kerak?",
          a: "Telefonda Telegram va shifokordan kirish kodi. Hech narsa o‘rnatish shart emas. Kabinetni keyinroq, kerak bo‘lsa, yoqish mumkin.",
        },
        {
          q: "Qaysi tillarda?",
          a: "Bot va Telegramdagi ilova — rus va o‘zbek tillarida. Shifokor kabineti — rus tilida.",
        },
        {
          q: "Ilova tibbiy maslahat beradimi?",
          a: "Yo‘q. U taomlarni shifokor tayinloviga ko‘ra hisoblaydi va oila yozuvlarini saqlaydi. Yordamchi faqat ilova ishi haqidagi savollarga javob beradi.",
        },
        {
          q: "Klinikani qanday ulash mumkin?",
          a: "Sahifa pastidagi arizani qoldiring — uni KetoCare administratori oladi.",
        },
      ],
    },
    lead: {
      h2: "Ariza qoldirish",
      text: "Bolalarni KetoCare’da kuzatmoqchi bo‘lgan klinikalar va shifokorlar uchun, shuningdek savollari bor oilalar uchun.",
    },
  },

  doctors: {
    seo: {
      title: "Shifokorlar va dietologlar uchun KetoCare",
      description:
        "Yosh va vaznga ko‘ra maslahatli tayinlov, shoshilinchlik bo‘yicha bemorlar ro‘yxati, oila kundaliklari, JSST me’yorlari bo‘yicha o‘sish, nazorat tashriflari va hisobotlar.",
    },
    hero: {
      h1: "Shifokor va dietolog nima oladi",
      lead: "Tayinlov, menyu, oila kundaliklari va bolaning holati — bitta kabinetda. Oila tayinlovingizni darhol oladi, siz esa uning yozuvlarini har kuni ko‘rasiz.",
    },
    patients: {
      title: "Avval — e’tibor kerak bo‘lgan bolalar",
      text: "Bemorlar ro‘yxati muammosi bor bolalarni o‘zi tepaga chiqaradi.",
      points: [
        "Oxirgi haftada uzoq davom etgan xuruj.",
        "Tayinlov hali yo‘q yoki oila ulanmagan.",
        "Oila bir necha kundan beri hech narsa yozmayapti — «Oilaga Telegramda eslatish» tugmasi.",
        "Kunning keto nisbati tayinlovdan farq qiladi.",
      ],
    },
    prescription: {
      title: "Bir daqiqada tayinlov",
      text: "Keto nisbati ro‘yxatdan tanlanadi — 1 : 1 dan 5 : 1 gacha, 0,5 qadam bilan.",
      points: [
        "Bolaning yoshi va vazniga ko‘ra kaloriya bo‘yicha maslahat.",
        "Uglevodlar chegarasi o‘zi hisoblanadi, uni o‘zgartirish mumkin.",
        "Oqsil, ovqatlanishlar soni, kerak bo‘lsa — suyuqlik.",
        "Oldingi tayinlovlar tayinlovlar tarixida qoladi.",
        "Tayinlov va menyu oila uchun bitta tugma bilan chop etiladi.",
      ],
    },
    menu: {
      title: "Tayinlovga mos menyu va taomlar",
      text: "Menyuni oila, shifokor yoki dietolog tuzadi — hamma bir xil narsani ko‘radi.",
      points: [
        "Har bir taom va butun kun tayinlov bo‘yicha tekshiriladi.",
        "Butun hafta, har kunning keto nisbati va kaloriyasi bilan.",
        "Kalkulyator mahsulot grammlarini ovqatlanish maqsadiga moslab tanlaydi.",
        "Menyuni shifokor tuzgan bo‘lsa, oila Telegramda xabar oladi.",
      ],
    },
    diaries: {
      title: "Oila kundaliklari — har kuni",
      text: "Oltita kundalik: xurujlar, ketonlar, vazn, o‘zini his qilish, dorilar, ovqatlanish. Oila ularni Telegramda yoki kabinetda yozadi.",
      points: [
        "Hafta, oy yoki tanlangan davr uchun grafiklar.",
        "Xurujlar — kunlar va sutka qismlari bo‘yicha jadval.",
        "Qabuldagi yozuvlarni shifokor o‘zi kiritadi.",
      ],
    },
    growth: {
      title: "O‘sish, tashriflar, hisobotlar",
      text: "Qabul uchun kerak bo‘lgan hamma narsa oldindan yig‘ilgan.",
      points: [
        "JSST me’yorlariga nisbatan bo‘y va vazn, sezilarli pasayish belgisi bilan.",
        "1, 3, 6, 9, 12 va 24 oyda nazorat tashriflari; oila uch kun oldin eslatma oladi.",
        "Davr uchun PDF hisobot.",
        "Davr bo‘yicha xulosa avtomatik qoralama sifatida tayyorlanadi. Hisobotga faqat shifokor tekshirgan va tasdiqlagan matn tushadi.",
      ],
    },
    connect: {
      h2: "Oilani qanday ulash mumkin",
      items: [
        {
          title: "Kartani siz ochasiz",
          text: "Qabulda: so‘rovnoma, tayinlov, dorilar. Karta bilan darhol ishlash mumkin.",
        },
        {
          title: "Oila kod oladi",
          text: "Sakkiz belgi va QR-kod. Kod bir hafta amal qiladi, uni bekor qilish mumkin.",
        },
        {
          title: "Oila kodni Telegramda ochadi",
          text: "Yoki kabinetda. Parol kerak emas. Ikkinchi kattani oila o‘zi taklif qiladi.",
        },
      ],
    },
    lead: {
      h2: "Klinikani ulash",
      text: "Ish pochtangizni qoldiring — arizani KetoCare administratori oladi.",
    },
  },

  families: {
    seo: {
      title: "Oilalar uchun KetoCare: menyu, grammlar va Telegramda kundalik",
      description:
        "Shifokor tayinloviga ko‘ra har bir mahsulot grammi ko‘rsatilgan menyu, taomlarni tekshirish, Telegramda kundalik, eslatmalar va yordamchi. Rus va o‘zbek tillarida.",
    },
    hero: {
      h1: "Oila nima oladi",
      lead: "Shifokor tayinlovi oshxonada tushunarli grammlarga, kundalik esa Telegramda bir-ikki bosishga aylanadi. Shifokor yozuvlarni ko‘radi va keyingi qabulni kutmaydi.",
      codeCta: "Menda kod bor",
    },
    start: {
      title: "Qanday boshlash kerak",
      points: [
        "Shifokor bolaning kartasini ochadi va kirish kodini beradi — sakkiz belgi yoki QR-kod.",
        "Kodni KetoCare Telegram-botiga yuboring — ilova ochiladi.",
        "Ro‘yxatdan o‘tish va parol kerak emas. Kabinetni keyinroq yoqish mumkin.",
      ],
    },
    menu: {
      title: "Menyu va grammlar",
      text: "Kecha, bugun va ertaga uchun menyu. Uni siz yoki shifokor tuzadi.",
      points: [
        "Har bir taomda «Nimani tortish kerak»: har bir mahsulot grammi.",
        "«Yeyildi» belgisi — bitta bosish bilan.",
        "Kun yakunlari tayinlov yonida: kaloriya, uglevodlar, keto nisbati.",
        "«Kechagidek» kechagi menyuni bo‘sh kunga ko‘chiradi.",
      ],
    },
    calc: {
      title: "O‘z taomingizni tekshiring",
      text: "Taomni mahsulotlardan yig‘ing — ilova u tayinlovga mos keladimi, darhol aytadi. Grammlarni ovqatlanish maqsadiga moslab tanlab ham beradi. Misolda sinab ko‘ring:",
    },
    diary: {
      title: "Bir-ikki bosishda kundalik",
      text: "Oltita kundalik: xurujlar, ketonlar, vazn, o‘zini his qilish, dorilar, ovqatlanish.",
      points: [
        "Bot bir necha soniyada yozadi va xato bo‘lmasligi uchun yozilganini takrorlaydi.",
        "Bola nima yeganini so‘z bilan yozish mumkin — bot mahsulotlar va grammlarni ko‘rsatadi va faqat tasdiqlaganingizdan keyin yozadi.",
        "Eslatmalar tanlangan vaqtda keladi — faqat kun uchun yozuv hali qilinmagan bo‘lsa.",
        "30 kunlik ketonlar, vazn va xurujlar grafiklari.",
      ],
    },
    help: {
      title: "Yordamchi va butun oila",
      points: [
        "Yordamchi ilovadan qanday foydalanish haqidagi savollarga tekshirilgan maqolalar asosida javob beradi. Tibbiy maslahat bermaydi.",
        "Ikkinchi ota-ona, buvi yoki enagani taklif qilish mumkin — ular o‘sha bolani ko‘radi.",
        "Bitta Telegram bir nechta bolani kuzatib borishi mumkin.",
        "Bot va ilova — rus va o‘zbek tillarida.",
      ],
    },
    end: {
      h2: "Shifokoringiz hali KetoCare’da ishlamaydimi?",
      text: "Unga tizim haqida aytib bering yoki ariza qoldiring.",
    },
  },

  calc: {
    dish: "Qaymoq va brokkolili omlet",
    target: "Misol uchun tayinlov: 3,5 : 1",
    ingredients: ["Tovuq tuxumi", "Qaymoq 33%", "Sariyog‘", "Brokkoli"],
    sliderLabel: "{name}, gramm",
    netCarbs:
      "Kletchatkasiz uglevodlar: {value} — keto nisbati shular bo‘yicha hisoblanadi.",
    verdictOk: "Tayinlovga mos",
    verdictLow: "Tayinlov uchun yog‘ kam",
    verdictHigh: "Yog‘ tayinlovdagidan ko‘p",
    disclaimer:
      "Bu to‘rt mahsulotli misol. Haqiqiy tayinlovni shifokor belgilaydi.",
  },

  how: {
    seo: {
      title: "KetoCare qanday ishlaydi",
      description:
        "To‘rt qadam: shifokor karta va tayinlov ochadi, oila kod oladi, Telegramda menyu va kundalik yuritadi, shifokor o‘zgarishlarni ko‘radi.",
    },
    hero: {
      h1: "Qanday ishlaydi",
      lead: "Birinchi qabuldan uydagi kundalik ishgacha — shifokor nima qiladi, oila nima qiladi va bu qayerda bo‘ladi.",
    },
    steps: [
      {
        who: "Shifokor",
        title: "Karta ochadi va tayinlovni belgilaydi",
        points: [
          "Bolaning so‘rovnomasi, tibbiy ma’lumotlari, dorilar sxemasi.",
          "Tayinlov: keto nisbati, kaloriya, oqsil, uglevodlar chegarasi, ovqatlanishlar soni.",
          "Yosh va vaznga ko‘ra kaloriya bo‘yicha maslahat.",
        ],
      },
      {
        who: "Shifokor va oila",
        title: "Oila kirish huquqini oladi",
        points: [
          "Shifokor kirish kodini beradi — sakkiz belgi va QR-kod. Kod bir hafta amal qiladi.",
          "Oila kodni KetoCare Telegram-botiga yuboradi yoki kabinetda kiritadi.",
          "Parol kerak emas. Ikkinchi kattani oila o‘zi taklif qiladi.",
        ],
      },
      {
        who: "Oila",
        title: "Uyda davolashni olib boradi",
        points: [
          "Taomlar va retseptlardan menyu tuzadi — ilova har bir taomni tayinlov bo‘yicha tekshiradi.",
          "Mahsulotlarni menyudagi grammlar bo‘yicha tortadi va yeyilganini belgilaydi.",
          "Xurujlar, ketonlar, vazn, o‘zini his qilish va dori qabulini yozadi.",
          "Tanlangan vaqtda eslatmalar oladi.",
        ],
      },
      {
        who: "Shifokor",
        title: "O‘zgarishlarni ko‘radi va tayinlovni o‘zgartiradi",
        points: [
          "Bemorlar ro‘yxati e’tibor kerak bo‘lganlarni birinchi ko‘rsatadi.",
          "Grafiklar, JSST me’yorlari bo‘yicha o‘sish, nazorat tashriflari, PDF hisobot.",
          "Yangi tayinlovni oila darhol ko‘radi va Telegramda xabar oladi.",
        ],
      },
    ],
    channels: {
      h2: "Qayerda ishlaydi",
      items: [
        {
          title: "Kabinet",
          text: "Shifokor va dietolog uchun — bemorlar bilan butun ish. Oila uchun — xohishga ko‘ra, kompyuterdan qulayroq bo‘lsa.",
        },
        {
          title: "Telegram-bot",
          text: "Kundalikka tez yozuvlar, eslatmalar, yangi tayinlov va menyu haqida xabarlar.",
        },
        {
          title: "Telegramdagi ilova",
          text: "Bot bilan chatdagi tugma orqali ochiladi: menyu, taomni hisoblash, retseptlar, kundalik, yordamchi.",
        },
      ],
    },
    roles: {
      h2: "Kim nimani ko‘radi",
      items: [
        {
          title: "Shifokor",
          text: "O‘z bemorlarini: tayinlov, dorilar, kundaliklar, hisobotlar.",
        },
        {
          title: "Dietolog",
          text: "O‘z bemorlarini: tayinlov, menyu, retseptlar va mahsulotlar. Tibbiy ma’lumotlar — faqat o‘qish uchun.",
        },
        {
          title: "Oila",
          text: "Faqat o‘z bolasini: tayinlov, menyu, kundaliklar, yordamchi.",
        },
        {
          title: "Klinika administratori",
          text: "Xodimlar hisoblari va arizalar. Tibbiy ma’lumotlarni ko‘rmaydi.",
        },
      ],
    },
    more: {
      text: "Ilova taomlarni qanday hisoblashi va ma’lumotlarni qanday himoyalashi —",
      link: "alohida sahifada",
    },
  },

  methodology: {
    seo: {
      title:
        "KetoCare taomlarni qanday hisoblaydi va ma’lumotlarni qanday himoyalaydi",
      description:
        "Keto nisbati va kaloriya oddiy so‘zlar bilan, mahsulotlar ma’lumotnomasini tekshirish, shifokor roli, yordamchi va ma’lumotlar himoyasi.",
    },
    hero: {
      h1: "Hisob va xavfsizlik",
      lead: "Oddiy so‘zlar bilan: ilova taomlarni qanday tekshiradi, qarorlarni kim qabul qiladi va bolaning ma’lumotlari qanday himoyalangan.",
    },
    sections: [
      {
        title: "Taom qanday tekshiriladi",
        points: [
          "Keto nisbati — bir gramm oqsil va uglevodga birgalikda necha gramm yog‘ to‘g‘ri kelishi. 4 : 1 tayinlovda 4 g yog‘ga 1 g oqsil va uglevod to‘g‘ri keladi.",
          "Kletchatka keto nisbatiga kirmaydi: u har bir mahsulot uglevodlaridan ayiriladi. Kunlik uglevodlar chegarasi esa barcha uglevodlar bo‘yicha hisoblanadi.",
          "Tuz va qalampir tarkibda turadi, lekin hisobga kirmaydi.",
          "Taom va butun kun tayinlov bilan solishtiriladi. Agar ular ruxsat etilganidan ko‘proq farq qilsa, ilova ogohlantiradi.",
        ],
      },
      {
        title: "Mahsulotlar haqidagi ma’lumotlar qayerdan",
        points: [
          "Ma’lumotnomadagi har bir mahsulotda 100 g dagi yog‘lar, oqsillar, uglevodlar, kletchatka va kaloriya hamda bu ma’lumotlar manbasi yozilgan.",
          "Mahsulot kaloriyasi uning yog‘, oqsil va uglevodlari bilan solishtiriladi. Raqamlar mos kelmasa, ma’lumotnoma ogohlantiradi.",
          "Ma’lumotnomani klinika dietologlari yuritadi.",
        ],
      },
      {
        title: "Qarorlarni kim qabul qiladi",
        points: [
          "Tayinlovni faqat shifokor belgilaydi va o‘zgartiradi. Oldingi tayinlovlar tayinlovlar tarixida qoladi.",
          "Ilova tashxis qo‘ymaydi, parhezni o‘zgartirmaydi va qanday davolash haqida maslahat bermaydi.",
          "Ota-ona bola nima yeganini so‘z bilan yozsa, ilova tanilgan mahsulotlar va grammlarni ko‘rsatadi. Yozuv faqat tasdiqlangandan keyin paydo bo‘ladi.",
          "Shifokor uchun xulosa avtomatik qoralama sifatida tayyorlanadi. Hisobotga faqat shifokor tekshirgan va tasdiqlagan matn tushadi.",
        ],
      },
      {
        title: "Yordamchi",
        points: [
          "Faqat ilova ishi haqidagi savollarga va faqat tekshirilgan maqolalar asosida javob beradi. Mos maqola bo‘lmasa, shuni aytadi.",
          "Dorilar, dozalar, alomatlar va parhezni o‘zgartirish haqida javob bermaydi — shifokorga yo‘naltiradi.",
          "Har bir javob ostida bu tibbiy maslahat emasligini eslatadi. Shifokor oila savollarini ko‘radi.",
        ],
      },
      {
        title: "Ma’lumotlar qanday himoyalangan",
        points: [
          "Oila faqat o‘z bolasini, shifokor faqat o‘z bemorlarini ko‘radi. Administrator tibbiy ma’lumotlarni ko‘rmaydi.",
          "Shifokor parol va telefondagi ilovadan olingan kod bilan kiradi.",
          "Ismlar va kontaktlar yordamchiga ham, avtomatik qoralamalarga ham uzatilmaydi.",
          "Tibbiy yozuvlar bilinmasdan o‘chirilmaydi, zaxira nusxalar shifrlangan holda saqlanadi.",
        ],
      },
    ],
  },

  notFound: {
    seo: {
      title: "Sahifa topilmadi — KetoCare",
      description: "KetoCare saytida bunday sahifa yo‘q.",
    },
    h1: "Bunday sahifa yo‘q",
    text: "Manzil xato yozilgan yoki sahifa ko‘chgan bo‘lishi mumkin. Bo‘limlardan biridan boshlang:",
  },

  footer: {
    disclaimer:
      "KetoCare shifokor nazorati ostida ketogen parhez terapiyasini olib borishga yordam beradi. Ilova tashxis qo‘ymaydi va maslahatni almashtirmaydi: tayinlov va uning o‘zgarishlari — shifokor qarori.",
    sectionsTitle: "Bo‘limlar",
    cabinetTitle: "Kabinet",
    contactsTitle: "Aloqa",
    telegram: "Telegram",
    copyright: "© {year} «RailTech» MChJ",
  },
};
