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
    toggleTheme: "Mavzuni almashtirish (yorug‘ / qorong‘i)",
    grams: "g",
    kcal: "kkal",
    fat: "Yog‘lar",
    protein: "Oqsillar",
    carbs: "Uglevodlar",
    netCarbs: "Sof uglevodlar",
    gki: "GKI indeksi",
    glucose: "Glyukoza",
    ketones: "Ketonlar",
    seizure: "Xuruj",
    weight: "Vazn",
    ratio: "Keto-nisbat",
    clinicCode: "Menda klinika kodi bor",
    login: "Kirish",
    admin: "Administrator paneli",
  },

  nav: {
    howItWorks: "Bu qanday ishlaydi",
    forFamilies: "Oilalar va bemorlarga",
    forDoctors: "Shifokorlar va klinikalarga",
    methodology: "Metodologiya va xavfsizlik",
    doctors: "Shifokorlarga",
    login: "Kirish",
    admin: "Admin",
    clinicCode: "Klinika kodi",
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
      title:
        "KetoCare — bolalar ketogenik parhez terapiyasi shifokor nazoratida",
      description:
        "Dorilarga chidamli epilepsiyali bolalarda ketogenik parhez terapiyasini kuzatib borish platformasi: shifokor tayinloviga ko‘ra taomlarni hisoblash, 6 ta kundalik, shifokor uchun dinamika. Veb va Telegram.",
    },
    hero: {
      badge: "Platforma ishlayapti va rivojlanmoqda",
      h1: "Bolaning ketogenik parhezi — qat'iy shifokor tayinlovi asosida",
      lead: "KetoCare oila va shifokorlar guruhini yagona klinik konturga birlashtiradi: xatolardan himoyalangan taomlarni avtomatik hisoblash, GKI va ketonlar monitoringi, xurujlar kundaligi (Veb + Telegram Mini App) va shifokor uchun bemorlar triaji.",
      ctaFamily: "Oilalar uchun erta kirish",
      ctaDoctors: "Shifokorlar va klinikalarga",
      ctaClinicCode: "Menda klinika kodi bor",
      chips: [
        "Faqat shifokor tayinlovi bo‘yicha",
        "Grammlarni matematik hisoblash",
        "GKI va Etvoter nazorati",
        "Veb + Telegram Mini App",
      ],
      card: {
        today: "Bugun",
        childName: "Anya · 7 yosh",
        childInitials: "AI",
        nextMeal: "Keyingi taom · 12:30",
        ratio: "3,50 : 1",
        dish: "Qaymoq va brokkoli bilan omlet",
        dishMacros:
          "310 kkal · yog‘lar 29,4 g · oqsillar 6,8 g · uglevodlar 1,6 g",
        dayVsPrescription: "Kunlik me’yorga nisbatan",
        caloriesLabel: "Kaloriyalar",
        caloriesValue: "742 / 1200 kkal",
        fatValue: "68,2 g",
        proteinValue: "17,1 g",
        carbsValue: "7,7 g",
        carbsLeft:
          "Bugun uchun qolgan uglevodlar: 12 dan <strong>4,3 g</strong>",
        quickKetones: "+ Ketonlar",
        quickWeight: "+ Vazn",
        quickSeizure: "Xuruj",
        caption: "Ota-ona kabineti — asosiy ekran shunday ko‘rinadi",
      },
      preview: {
        tabParent: "Ota-ona rejimi (Kundalik va ovqatlanish)",
        tabDoctor: "Shifokor rejimi (Klinik triaj va GKI)",
        parent: {
          childName: "Anya I. · 7 yosh",
          childInitials: "AI",
          today: "Bugun",
          targetRatioBadge: "3,50 : 1 — Me’yorda",
          nextMeal: "Tushlik · 12:30",
          dish: "Qaymoq va brokkoli bilan omlet",
          dishGrams: "Tuxum 40 g · Qaymoq 35 g · Sariyog‘ 22 g · Brokkoli 25 g",
          dishMacros:
            "310 kkal · yog‘lar 29,4 g · oqsillar 6,8 g · uglevodlar 1,6 g",
          dayVsPrescription: "Kunlik me’yorga nisbatan",
          caloriesLabel: "Kaloriyalar",
          caloriesValue: "742 / 1200 kkal",
          fatValue: "68,2 g",
          proteinValue: "17,1 g",
          carbsValue: "7,7 g",
          carbsLeft:
            "Bugun uchun qolgan uglevodlar: 12 dan <strong>4,3 g</strong>",
          gkiBadge: "GKI 1,8 — Chuqur ketoz",
          gkiDetails: "Glyukoza: 4,5 mmol/l · Ketonlar: 2,5 mmol/l",
          quickKetones: "+ Ketonlar",
          quickGlucose: "+ Glyukoza",
          quickWeight: "+ Vazn",
          quickSeizure: "Xuruj",
          caption:
            "Ota-ona kabineti (PR #303) — aniq grammlar, kunlik maqsadlar va tezkor amallar",
        },
        doctor: {
          pinnedHeader: {
            patientName: "Anya I. · 7 yosh (21,4 kg, 118 sm)",
            prescription: "Tayinlov: 3,50 : 1 · 1200 kkal/kun · oqsil 25 g",
            gki: "Joriy GKI: 1,80 (me’yorda)",
          },
          triageTitle: "Bemorlarning klinik triaji (Svetofor)",
          triageRed: {
            name: "Misha K. · 5 yosh",
            badge: "Qizil zona",
            reason:
              "4 kundan beri ma’lumot yo‘q · Gipoglikemiya va xuruj xavfi",
          },
          triageYellow: {
            name: "Anya I. · 7 yosh",
            badge: "Sariq zona",
            reason: "Nisbat 2,90 : 1 (3 kundan beri maqsaddan past)",
          },
          triageGreen: {
            name: "Damir T. · 9 yosh",
            badge: "Yashil zona",
            reason: "GKI 1,45 · Ketonlar 3,2 mmol/l · 14 kunda 0 ta xuruj",
          },
          trendTitle: "Ketonlar va glyukoza trendi (terapevtik koridor)",
          trendKetones: "Qon ketonlari: 1,2 → 2,8 mmol/l (o‘sish)",
          trendGlucose: "Qon glyukozasi: 4,8 → 4,3 mmol/l (me’yor)",
          trendGki: "GKI 3,8 dan 1,8 gacha tushdi (maqsadli ketozga erishildi)",
          caption:
            "Shifokor kabineti (PR #303) — klinik svetofor, qadalgan panel va trendlar",
        },
      },
    },
    stats: [
      {
        value: "3,50 : 1",
        label: "Tayinlovning maqsadli koridori",
        note: "Matematik LP nazorati",
      },
      {
        value: "< 10%",
        label: "Etvoter formulasi bo‘yicha tekshiruv",
        note: "Mahsulotlar bazasini xatolardan himoyalash",
      },
      {
        value: "5 soniya",
        label: "Xuruj yoki ketonlarni qayd etish",
        note: "Veb + Telegram Mini App",
      },
      {
        value: "2FA",
        label: "Klinikaning xavfsiz konturi",
        note: "Ruxsatlarni ajratish va audit",
      },
    ],
    portalNav: {
      eyebrow: "Platforma yo‘nalishlari",
      h2: "Oilalar va klinikalar uchun yagona tibbiy portal",
      lead: "Axborot muhiti huquqlarni qat’iy ajratgan va ma’lumotlarni uzluksiz almashadigan ixtisoslashtirilgan konturlarga bo‘lingan.",
      familyCard: {
        badge: "Ota-onalar uchun",
        title: "Oilalar va bemorlarga",
        desc: "Oshxonada aniq grammlar, o‘rinbosarlarni tezkor hisoblash, Telegram Mini App va daftarlarsiz 6 ta kundalik.",
        cta: "Oilalar uchun batafsil",
      },
      doctorCard: {
        badge: "Mutaxassislar uchun",
        title: "Shifokorlar va klinikalarga",
        desc: "Bemorlarning klinik svetofori, tezkor triaj, LP-grammlarni tanlash va qabulga avtomatik hisobot.",
        cta: "Shifokor kabineti batafsil",
      },
      methodologyCard: {
        badge: "Ilmiy asos",
        title: "Metodologiya va isbotlilik",
        desc: "Izolyatsiya qilingan keto_engine matematik yadrosi, Etvoter tekshiruvi, 4:1 va MAD protokollari hamda 2FA xavfsizligi.",
        cta: "Metodologiyani o‘rganish",
      },
    },
    mission: {
      eyebrow: "Missiya",
      h2: "Uy sharoitidagi terapiya klinikadagidek aniq bo‘lishi uchun",
      lead: "Ketogenik parhez terapiyasi dori vositalari yordam bermagan bolalarga yordam berishi mumkin — ammo faqat tayinlov aniq bajarilganda. Qabullar oralig‘ida oila hisob-kitoblar bilan yolg‘iz qoladi. KetoCare oila va shifokorni yagona konturga birlashtiradi: tayinlov, hisob-kitoblar, kundaliklar va dinamika bitta tizimda.",
      families: {
        title: "Oilalar nimani kutishi mumkin",
        items: [
          "Har bir taomni tayinlovga mos hisoblash — kalkulyator va daftarsiz",
          "Kunlik menyu va 6 ta kundalik — telefondan ikki harakatda",
          "Shifokor qabullar oralig‘ida dinamikani ko‘radi — siz yolg‘iz qolmaysiz",
        ],
      },
      doctors: {
        title: "Shifokorlar nimani kutishi mumkin",
        items: [
          "Versiyalar va og‘ish me’yorlariga ega tayinlovlar — tarix o‘chirilmaydi",
          "Xavf darajasi bo‘yicha bemorlar ro‘yxati va dinamikali karta",
          "Oila yozuvlaridan qabul uchun hisobot — xotiradan emas, ma’lumotlar asosida suhbat",
        ],
      },
    },
    steps: {
      eyebrow: "Tizim qanday tuzilgan",
      h2: "Uch rol, bitta kundalik, oshxonada arifmetikasiz",
      items: [
        {
          title: "Shifokor tayinlov kiritadi",
          text: "Ketogenik nisbat, kaloriya miqdori, oqsil maqsadi va uglevodlar chegarasi — barchasi bir joyda, amal qilish sanasi bilan.",
        },
        {
          title: "Oila bajaradi",
          text: "Platforma taomlar va menyuni tayinlovga moslab hisoblaydi va kunlik me’yorga muvofiqligini darhol ko‘rsatadi. Kundaliklar — veb yoki Telegram orqali bir necha soniyada.",
        },
        {
          title: "Shifokor dinamikani ko‘radi",
          text: "Ketonlar, vazn, xurujlar va ovqatlanish — bemor kartasida. Qabulga qadar — daftar va eslab aytish o‘rniga tayyor klinik hisobot.",
        },
      ],
      link: "Har bir bosqich haqida batafsil",
    },
    forDoctors: {
      eyebrow: "Shifokorlar va klinikalarga",
      h2: "Ketoterapiyani muntazam qiyinchiliklarsiz klinik nazorat qilish",
      lead: "Tizim epileptolog-shifokorlar va keto-diyetologlar uchun yaratilgan: birinchi tayinlovdan boshlab ob’yektiv ma’lumotlar bilan muntazam qabulgacha.",
      items: [
        {
          title: "Bemorlarning tezkor klinik triaji",
          text: "Kabinetga kirganda shifokor qizil va sariq zonalardagi bemorlarni darhol ko‘radi: ketoz buzilish xavfi, yozuvlar yo‘qligi yoki xurujlar ko‘payishi.",
        },
        {
          title: "Grammlarni matematik tanlash (LP-dvijok)",
          text: "keto_engine yadrosidagi chiziqli dasturlash grammlarni matematik aniqlikda tanlab, belgilangan nisbat va kaloriyani qat’iy saqlaydi.",
        },
        {
          title: "GKI nazorati va mahsulotlar bazasini himoya qilish (Etvoter)",
          text: "Glyukozo-keton indeksini avtomatik hisoblash va Etvoter formulasi bo‘yicha tekshirish mahsulot yorliqlaridagi xatolarni bartaraf qiladi.",
        },
        {
          title: "Himoyalangan kontur: 2FA va klinika kodlari",
          text: "Shifokorlar hisoblarini ikki bosqichli himoyalash (2FA), kirish huquqlarini ajratish va oilalarni ochiq ro‘yxatdan o‘tmasdan bir martalik kodlar bilan ulash.",
        },
      ],
      cta: "Klinikalar uchun batafsil",
    },
    forFamilies: {
      eyebrow: "Oilalar va bemorlarga",
      h2: "Oila yo‘li: oshxonada osonlik va har kuni ishonch",
      lead: "Bolaning keto-parhezi zargarona aniqlikni talab qiladi. KetoCare hisob-kitob va nazoratni o‘z zimmasiga oladi, shunda siz butun e’tiboringizni g‘amxo‘rlikka qaratishingiz mumkin.",
      steps: [
        {
          num: "1",
          title: "Davolovchi shifokordan kod olish",
          text: "Yuzma-yuz qabulda shifokor terapiya parametrlarini sozlaydi va tezkor kirish uchun shaxsiy bir martalik klinika kodini beradi.",
        },
        {
          num: "2",
          title: "Tayyor menyu va oshxonadagi almashtirish kalkulyatori",
          text: "Har bir taom uchun grammgacha aniq o‘lchovlar. Agar mahsulot uyda bo‘lmasa — algoritm nisbatni saqlagan holda unga teng qiymatli muqobilini tanlaydi.",
        },
        {
          num: "3",
          title: "Ketonlar, glyukoza va xurujlarni 5 soniyada yozib borish",
          text: "O‘lchovlarni veb-kabinet yoki Telegram Mini App orqali kiriting. Xuruj birgina tugma orqali qayd etiladi («hozir»), tafsilotlar esa keyinroq kiritiladi.",
        },
        {
          num: "4",
          title: "Shifokor bilan doimiy aloqa",
          text: "Shifokor bolaning ma’lumotlarini onlayn ko‘rib turadi, navbatdagi qabul sanasiga esa tizim tayyor klinik hisobotni shakllantiradi.",
        },
      ],
    },
    methodology: {
      eyebrow: "Metodologiya va xavfsizlik",
      h2: "Klinik qat'iylik, matematika va tibbiy ma'lumotlar xavfsizligi",
      lead: "Dorilarga chidamli epilepsiya terapiyasi hisobdagi xatoliklarni kechirmaydi. Biz arxitekturamiz asosiga dalillarga asoslangan tibbiyot standartlarini qo‘ydik.",
      items: [
        {
          title: "Izolyatsiyalangan matematik yadro",
          text: "Hisob-kitoblar keto_engine yadrosi tomonidan amalga oshiriladi (chiziqli dasturlash va simpleks usuli). Formulalar qat'iy va oraliq yaxlitlashlarsiz ishlaydi.",
        },
        {
          title: "Formulalar siljishidan himoya",
          text: "Sof uglevodlarni qat'iy hisobga olish (har bir mahsulot bo‘yicha kletchatkani ayirish, manfiy qiymatlarsiz) klinik buzilishlarni istisno etadi.",
        },
        {
          title: "Tibbiy sir va 2FA himoyasi",
          text: "Shifokorlar uchun ikki bosqichli autentifikatsiya, zaxira nusxalarini shifrlash va qat'iy kirish: ota-onalar faqat o‘z farzandini ko‘radi, begona kirish imkonsiz.",
        },
        {
          title: "Gallyutsinatsiyalarsiz mas'uliyatli AI",
          text: "AI yordamchisi yozuvlarni tanib olish va qoralamalarni tayyorlashga yordam beradi, biroq klinik qarorlar qabul qilmaydi va tasdiqlanmagan tavsiyalar bermaydi.",
        },
      ],
    },
    calc: {
      eyebrow: "O‘zingiz sinab ko‘ring",
      h2: "3,5 : 1 tayinlovi bo‘yicha nonushta yig‘ing",
      lead1:
        "Ketogenik nisbat — bu yog‘larning oqsillar va uglevodlar yig‘indisiga nisbati (kletchatka hisobga olinmaydi). Har bir taom shifokor tayinloviga og‘ish me’yorida aniq mos kelishi kerak.",
      lead2:
        "Slayderlarni suring — hisob bir zumda bajariladi. Haqiqiy hayotda buni platforma qiladi: har bir ovqatlanishda tarozilar, kalkulyator va daftarsiz.",
      note: "Mahsulotlar ma’lumotlari — USDA FoodData Central. Mahsulotda hisoblash texnik topshiriq formulalari bo‘yicha tekshirilgan izolyatsiyalangan yadro tomonidan bajariladi.",
      dish: "Qaymoq va brokkoli bilan omlet",
      ingredients: ["Tovuq tuxumi", "Qaymoq 33%", "Sariyog‘", "Brokkoli"],
      netCarbs: "Shundan sof uglevodlar",
      netCarbsNote: "keto-nisbat shunga ko‘ra hisoblanadi",
      atwaterTitle: "Etvoter formulasi bo‘yicha tekshiruv",
      atwaterBadge:
        "✓ Etvoter formulasi bo‘yicha tekshiruv: xatolik < 2% (me’yor < 10%)",
      atwaterNote:
        "KetoCare har bir taom va mahsulotlar bazasini avtomatik tekshiradi: hisoblangan kaloriya (9×Y + 4×O + 4×Cnet) yorliq bilan solishtiriladi va noto‘g‘ri ma’lumotlarni cheklaydi.",
      targetRatioCorridor:
        "Shifokor tayinlovining maqsadli koridori: 3,50 : 1 (og‘ish ±0,15)",
      disclaimer:
        "Bu formulaning namoyishi bo‘lib, ovqatlanishni rejalashtirish vositasi emas. Bolaning ovqatlanishi shifokor tayinloviga binoan shaxsiy kabinetda hisoblanadi.",
      sliderLabel: "{name}, gramm",
      verdictOk:
        "3,5 : 1 tayinloviga mos keladi (dastlabki og‘ish me’yori ±0,15)",
      verdictLow:
        "Tayinlovdan past — yog‘ qo‘shing yoki uglevodlarni kamaytiring",
      verdictHigh: "Tayinlovdan yuqori — yog‘lar tayinlangandan ko‘proq",
    },
    diaries: {
      eyebrow: "Kundaliklar",
      h2: "Oltita kundalik — bir necha harakatda",
      lead: "Xurujlar, ketonlar, vazn, taom, dorilar va holat. Oila yozgan barcha ma’lumotlar — veb, bot yoki mini-ilovadan — bitta kundalikka tushadi va shifokorga ko‘rinadi.",
      ketones: {
        title: "14 kunlik ketonlar",
        badge: "3,5 mmol/l",
        caption:
          "Ketoz holatiga chiqish grafikda yaqqol ko‘rinadi, «sezgi bo‘yicha» emas",
        chartAlt:
          "14 kunlik ketonlar grafigi: ko‘rsatkich 1,2 dan 3,5 mmol/l gacha bir tekis o‘smoqda.",
      },
      seizure: {
        title: "Xuruj — darhol, tafsilotlar — keyin",
        text: "Xuruj vaqtida hech kim murakkab forma to‘ldirmaydi. Yozuv bir-ikki harakatda amalga oshiriladi: turi va «hozir». Sabablar va tavsifni vaziyat tinchigach qo‘shish mumkin. Shifokor uchun esa yozuvlar xuruj turlari bo‘yicha oylik jadvalga avtomatik joylashadi.",
        chipType: "Toniko-klonik",
        chipNow: "Hozir",
      },
      progress: {
        title: "Progress — bu «yeyildi» emas, «qoldi»",
        text: "«Bugungi uglevodlardan 4,3 g qoldi» — bu arifmetika masalasi emas, aniq javob. Ogohlantirish faqat tayinlovdan haqiqiy chetlanish bo‘lgandagina chiqadi.",
      },
    },
    telegram: {
      eyebrow: "Telegram",
      h2: "Yozib borish — to‘g‘ridan-to‘g‘ri messenjerdan",
      lead: "Ketonlar o‘lchovi — botga bitta xabar. Bot va mini-ilova platformaning bir qismi: hammasi bitta kundalikka tushadi va shifokorga ko‘rinadi.",
      items: [
        "Ketonlar, vazn, holat va xurujlar — tugmalar orqali 2–4 harakatda",
        "Taomni erkin matn bilan kiritish — AI tarkibni ajratadi, siz tasdiqlaysiz",
        "O‘lchovlar va dorilar haqida eslatmalar — oiladagi barcha kattalarga",
        "Telegram ichidagi Mini App: kunlik reja, kalkulyator, retseptlar, kundalik va «Yaqinlar»",
      ],
      botLabel: "bot",
      replay: "Yana bir bor",
      caption:
        "Ssenariy namoyishi. Bot terapiya bo‘yicha maslahat bermaydi — faqat tezkor yozuvlar va eslatmalar",
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
          text: "Yozib olindi ✓ Ketonlar 2,6 mmol/l (qon), bugun 08:12 da. Kundalikka kiritildi — shifokor ko‘radi.",
          time: "08:12",
        },
        { from: "user", text: "vazn 21,4", time: "14:05" },
        {
          from: "bot",
          text: "Vazn 21,4 kg. Bugungi kunga yozilsinmi?",
          time: "14:05",
          chips: ["Ha, bugunga", "Boshqa sana"],
        },
        { from: "user", text: "Ha, bugunga", time: "14:05" },
        {
          from: "bot",
          text: "Yozib olindi ✓ Vazn 21,4 kg, bugun. Dinamikani shifokor kartada ko‘radi.",
          time: "14:06",
        },
      ] as ChatMsg[],
    },
    doctorsTeaser: {
      eyebrow: "Shifokorlar va diyetologlarga",
      h2: "«Qancha bemor» emas, bugun kim bilan shug‘ullanish kerak",
      lead: "Bemorlar ro‘yxati xavf darajasiga ko‘ra saralangan: oilaning sukut saqlashi, ovqatlanishning me’yordan chiqishi, haftalik xurujlarning ko‘payishi.",
      cta: "Shifokor kabineti batafsil",
      queueTitle: "Diqqat navbati",
      queue: [
        {
          name: "Misha K.",
          status: "ma’lumot yo‘q",
          reason: "4 kundan beri kundalik yozuvlari yo‘q",
          age: "4 kun oldin",
          level: "danger",
        },
        {
          name: "Anya I.",
          status: "ovqatlanish",
          reason: "Kun ketma-ket 3 kun me’yordan tashqarida",
          age: "bugungi ma’lumot",
          level: "warning",
        },
        {
          name: "Vera S.",
          status: "xurujlar",
          reason: "O‘tgan haftadagiga nisbatan xurujlar ko‘proq",
          age: "kechagi ma’lumot",
          level: "warning",
        },
      ] as QueueItem[],
      queueNote:
        "Holat har doim so‘z bilan takrorlanadi — rang yagona belgi emas",
    },
    trust: {
      eyebrow: "Nega bunga ishonish mumkin",
      h2: "Hisob-kitobdagi xatolik — klinik xavf. Biz shundan kelib chiqib loyihalashtiramiz.",
      items: [
        {
          title: "Hisob etalonlar bilan tekshiriladi",
          text: "Hisoblash yadrosi qolgan koddan ajratilgan va har bir o‘zgarishda etalon ssenariylar to‘plami bilan tekshiriladi.",
        },
        {
          title: "Rollar bo‘yicha kirish",
          text: "Ota-ona o‘z bolasini, shifokor esa o‘z bemorlarini ko‘radi. Kirish ikki bosqichli himoyaga ega, barcha amallar audit jurnalida qayd etiladi.",
        },
        {
          title: "AI insonlar o‘rniga qaror qabul qilmaydi",
          text: "AI erkin matnni ajratish va hisobot qoralamalarini tayyorlashga yordam beradi, ammo har bir yozuvni inson tasdiqlaydi.",
        },
        {
          title: "Tanlov uchun kanallar",
          text: "Veb-kabinet, Telegram-bot va mini-ilova bitta kundalikka yozadi. Oila bugun qaysi biri qulay bo‘lsa, shundan foydalanadi.",
        },
      ],
    },
    faq: {
      h2: "Ko‘p beriladigan savollar",
      items: [
        {
          q: "Tizimga qanday kirish mumkin?",
          a: "Kirishni davolovchi shifokor-epileptolog yoki keto-diyetolog yuzma-yuz qabulda ochadi: mutaxassis bazaviy parametrlarni kiritadi va oilaga bir martalik klinika kodini beradi. Agar shifokoringiz hali KetoCare bilan ishlamasa, erta kirish arizasini qoldiring — biz klinika bilan bog‘lanamiz.",
        },
        {
          q: "Telefonda Telegram orqali foydalanish mumkinmi?",
          a: "Ha. Kundalikning barcha imkoniyatlari to‘g‘ridan-to‘g‘ri smartfondan Telegram-bot va to‘liq funksional Telegram Mini App orqali ishlaydi. Siz xurujlarni 1 bosishda qayd etishingiz, ketonlar va glyukoza o‘lchovlarini yuborishingiz va menyuni ko‘rishingiz mumkin.",
        },
        {
          q: "Tizim klassik keto-parhez (4:1, 3:1) va modifikatsiyalangan Atkins parhezini (MAD) qo‘llab-quvvatlaydimi?",
          a: "Ha, KetoCare parhez terapiyasining barcha tayinlangan protokollarini qo‘llab-quvvatlaydi: 4:1, 3,5:1, 3:1 nisbatli klassik ketogenik parhez, o‘rta zanjirli triglitseridlar (MCT) parhezi, uglevodlar 10 dan 20 g/kunga cheklangan modifikatsiyalangan Atkins parhezi (MAD) va past glikemik indeksli parhez (LGIT).",
        },
        {
          q: "Bolaning tibbiy ma’lumotlari qanday himoyalangan?",
          a: "Ma’lumotlar klinik xavfsizlik standartlari bo‘yicha himoyalangan: kirish qat'iy rollar bo‘yicha (ota-ona faqat o‘z bolasini, shifokor o‘z bemorlarini ko‘radi), mutaxassislar uchun 2FA autentifikatsiyasi, bazaga barcha murojaatlarning auditi va zaxira nusxalarini shifrlash.",
        },
        {
          q: "Bu shifokor yoki diyetologning o‘rnini bosadimi?",
          a: "Qat'iyan yo‘q. Ketogenik parhez terapiyasi jiddiy tibbiy davolash usuli bo‘lib, faqat shifokor-epileptolog va diyetolog nazorati ostida olib borilishi shart. Tizim tayinlovga rioya qilishga yordam beradi va hisoblashdagi xatoliklarni bartaraf etadi.",
        },
        {
          q: "Har ikki ota-ona va qarindoshlar kundalik yurita oladimi?",
          a: "Ha. Bolaning profiliga bir nechta kattalarning hisoblarini ulash mumkin (ota-ona, buvi, enaga). Barcha yozuvlar bir zumda sinxronlanadi va shifokor yagona dolzarb manzarani ko‘radi.",
        },
      ],
    },
    cta: {
      h2: "Tanishuvni boshlaymiz",
      lead: "Platforma allaqachon ishlayapti va rivojlanishda davom etmoqda. Oilaga kirishni davolovchi shifokor ochadi; shifokorlar va klinikalarni to‘g‘ridan-to‘g‘ri ulaymiz.",
      family: {
        eyebrow: "Oilalarga",
        title: "Oilangiz uchun kirish",
        text: "Oilaga kirishni shifokor qabulda taklifnoma bilan ochadi. Agar shifokoringiz hali biz bilan bo‘lmasa, pochtangizni qoldiring: uni platforma bilan tanishtirishga yordam beramiz.",
      },
      doctors: {
        eyebrow: "Shifokorlar va klinikalarga",
        title: "Pilot loyiha uchun ariza",
        text: "Shifokor kabinetini ko‘rsatamiz, klinikangiz protokollarini muhokama qilamiz va birinchi bemorlarni siz bilan birga ulaymiz.",
        cta: "Batafsil va ariza",
      },
    },
  },

  howItWorks: {
    seo: {
      title: "KetoCare qanday ishlaydi — shifokor tayinlovidan hisobotgacha",
      description:
        "KetoCare ketogenik parhez terapiyasining besh bosqichi: shifokor tayinlov kiritadi, oila menyu tuzadi va kundalik yuritadi, shifokor dinamikani ko‘radi. Veb-kabinet, Telegram-bot, mini-ilova.",
    },
    hero: {
      eyebrow: "Bu qanday ishlaydi",
      h1: "Tayinlovdan hisobotgacha — bitta kontur",
      lead: "Shifokor, oila va ma’lumotlar bitta tizimda ishlaydi. Hech narsa daftardan qayta ko‘chirilmaydi, kalkulyatorda qayta hisoblanmaydi va qabullar oralig‘ida yo‘qolmaydi.",
    },
    steps: [
      {
        role: "Shifokor",
        title: "Oilani taklif qiladi va tayinlov kiritadi",
        paragraphs: [
          "Oilaga kirishni davolovchi shifokor ochadi: qabulda taklif havolasini beradi. U orqali ota-ona bola profilini yaratadi va qisqa so‘rovnomani to‘ldiradi. Tashxis va dorilarning aniq ro‘yxatini shifokor kiritadi.",
          "Keyin tayinlov belgilanadi: ketogenik nisbat, kunlik kaloriya, oqsil maqsadi va uglevodlar chegarasi, amal qilish sanasi bilan. Har bir o‘zgarish — yangi versiya, tarix to‘liq saqlanadi.",
        ],
        chips: ["3,5 : 1", "1200 kkal/kun", "oqsil 25 g", "uglevodlar ≤ 12 g"],
      },
      {
        role: "Oila",
        title: "Menyuni arifmetikasiz yig‘adi",
        paragraphs: [
          "Ota-ona mahsulotlar va grammlarni tanlaydi — platforma KBJU va nisbatni darhol hisoblaydi va taom tayinlovga mos kelishini aytadi. Taom kiritish bo‘sh qidiruvdan emas, «Yaqinda ishlatilgan» va «Tez-tez ishlatiladigan» ro‘yxatidan boshlanadi.",
        ],
        verdictBadge: "3,52 : 1",
        verdictText: "Tayinlovga mos keladi · dastlabki og‘ish me’yori ±0,15",
        chips: [],
      },
      {
        role: "Oila",
        title: "Kundaliklarni osonlik bilan yuritadi",
        paragraphs: [
          "Xurujlar, ketonlar, vazn, taom, dorilar va holat — veb orqali yoki Telegram-botga qisqa xabar bilan. Taomni erkin matn bilan tasvirlash mumkin: AI tarkibni ajratadi, siz esa tasdiqlaysiz. Xuruj darhol bir-ikki harakatda qayd etiladi: turi va «hozir», tafsilotlar — keyinroq.",
        ],
        chips: ["+ Ketonlar", "+ Vazn", "+ Dori", "Xuruj — hozir"],
      },
      {
        role: "Shifokor",
        title: "Qabullar oralig‘ida dinamikani ko‘radi",
        paragraphs: [
          "Ketonlar, vazn, xurujlar va ovqatlanish — bitta vaqt shkalasida, tayinlov o‘zgarishi belgilari bilan. E’tibor talab qiladigan bemorlar ro‘yxatning yuqorisiga avtomatik ko‘tariladi.",
        ],
        chips: [],
      },
      {
        role: "Birgalikda",
        title: "Qabul xotiradan emas, ma’lumotlar asosida o‘tadi",
        paragraphs: [
          "Tashrifga qadar davr bo‘yicha umumiy hisobot tayyor bo‘ladi: ko‘rsatkichlar dinamikasi, xurujlar, tayinlovga rioya qilinishi. Suhbat faktlar bilan boshlanadi, tuzatish qarorlarini shifokor qabul qiladi.",
        ],
        chips: [],
      },
    ] as HowStep[],
    channels: {
      h2: "Bitta kundalik, to‘rtta kanal",
      lead: "Oila qayerga yozsa ham — ma’lumotlar bir joyga tushadi va shifokorga ko‘rinadi.",
      items: [
        {
          title: "Veb-kabinet",
          text: "Ota-ona, shifokor, diyetolog va administrator kabinetlari. Menyu, kundaliklar, bemor kartasi, hisobotlar.",
        },
        {
          title: "Telegram-bot",
          text: "Qisqa xabarlar orqali kundalik yozuvlarini tezkor kiritish va o‘lchovlar haqida eslatmalar.",
        },
        {
          title: "Mini App",
          text: "Telegram ichidagi ota-ona kabineti — alohida ilova o‘rnatishni talab qilmaydi.",
        },
        {
          title: "AI-assistent",
          text: "Erkin matnni tahlil qiladi va hisobot qoralamalarini tayyorlaydi. Har bir yozuvni inson tasdiqlaydi.",
        },
      ],
    },
    status: {
      eyebrow: "Loyiha holati",
      h2: "Asosiy funksiyalar allaqachon ishlamoqda",
      nowTitle: "Bugun ishlayapti",
      now: [
        "Ota-ona, shifokor va administrator kabinetlari",
        "Etalon testlarga ega hisoblash yadrosi",
        "Tayinlovlar, mahsulotlar bazasi, menyu va 6 ta kundalik",
        "2FA orqali kirish, kirish rollari, audit jurnali",
      ],
      nextTitle: "Rivojlanishda",
      next: [
        "Telegram-bot va eslatmalar",
        "Telegram ichidagi Mini App",
        "Oila uchun AI-assistent va hisobot qoralamalari",
      ],
      note: "Ochiq ro‘yxatdan o‘tish yo‘qligi rejalashtirilgan: oilaga kirishni shifokor ochadi, shifokorlar va klinikalarni to‘g‘ridan-to‘g‘ri ulaymiz.",
    },
    cta: {
      h2: "O‘z holatingizda ko‘ring",
      lead: "Oilalarga — erta kirish kutish ro‘yxati. Shifokorlar va klinikalarga — kabinet namoyishi bilan pilot loyiha.",
    },
  },

  doctors: {
    seo: {
      title:
        "Shifokorlar va diyetologlar uchun KetoCare — ketogenik parhez nazorati",
      description:
        "KetoCare shifokor kabineti: xavf bo‘yicha bemorlar ro‘yxati, ketonlar, vazn va xurujlar dinamikasi kartasi, qabulga hisobot. Klinika uchun pilot arizasi.",
    },
    hero: {
      eyebrow: "Shifokorlar va diyetologlarga",
      h1: "Tayinlov bajarilmoqda. Siz buni ko‘rib turibsiz.",
      lead: "Qabullar oralig‘ida oila yolg‘iz qoladi: tortadi, hisoblaydi, daftarga yozadi. KetoCare tayinlov ijrosini nazorat qilinadigan konturga o‘tkazadi — siz uch oyda bir marta xotiradan aytilgan gaplarni emas, real dinamika va chetlanishlarni ko‘rasiz.",
      ctaPilot: "Pilot uchun ariza",
      ctaHow: "Kontur qanday tuzilgan",
      card: {
        title: "Tayinlov · Anya I.",
        badge: "16.08 dan faol",
        ratioLabel: "Nisbat",
        ratioValue: "3,5 : 1",
        caloriesLabel: "Kaloriya miqdori",
        caloriesValue: "1200 kkal",
        proteinLabel: "Oqsil",
        proteinValue: "25 g/kun",
        carbsLabel: "Uglevodlar",
        carbsValue: "≤ 12 g/kun",
        mealsLabel: "Kunlik ovqatlanishlar soni",
        mealsValue: "4",
        note: "Oila bu maqsadlarni o‘z kabinetida ko‘radi; har bir taom va kun ular bilan avtomatik tarzda, nisbat bo‘yicha og‘ish me’yori bilan tekshiriladi.",
      },
    },
    benefits: {
      h2: "Ko‘rsatkichlar vitrinasi emas, haqiqiy ish kuni",
      queue: {
        title: "Diqqat navbati",
        text: "Bemorlar ro‘yxati alifbo bo‘yicha emas, xavf bo‘yicha saralangan: oilaning javobsizligi, ovqatlanishning me’yordan chiqishi, haftadan haftaga xurujlarning ko‘payishi.",
        rows: [
          {
            name: "Misha K.",
            reason: "4 kundan beri kundalik yozuvlari yo‘q",
            level: "danger",
          },
          {
            name: "Anya I.",
            reason: "kun ketma-ket 3 kun me’yordan tashqarida",
            level: "warning",
          },
        ] as { name: string; reason: string; level: Level }[],
      },
      chart: {
        title: "Bemor kartasi",
        text: "Ketonlar, vazn, xurujlar, ovqatlanish va dorilar — bitta vaqt shkalasida, tayinlov o‘zgarishi belgilari bilan: tuzatishdan keyin nima o‘zgargani yaqqol ko‘rinadi.",
        legend: "tayinlov o‘zgarishi 3,0 → 3,5",
        chartAlt:
          "Davr bo‘yicha ko‘rsatkich grafigi: sekin o‘sish, tayinlov o‘zgarishi belgisidan so‘ng o‘sish sezilarli darajada tezlashadi.",
      },
      report: {
        title: "Qabulga hisobot",
        text: "Tashriflar oralig‘idagi davr bo‘yicha xulosa oila yozuvlaridan shakllanadi: dinamika, xurujlar, tayinlovga rioya qilinishi. Eksport — PDF va CSV.",
        sampleTitle: "Xulosa · 16.08 — 30.08",
        sampleLines: [
          "Ketonlar: mediana 2,8 mmol/l · Vazn: −0,3 kg",
          "Xurujlar: 4 ta (o‘tgan davrda 7 ta edi)",
          "Nisbat bo‘yicha me’yorda bo‘lgan kunlar: 14 tadan 11 ta",
        ],
      },
      grid: {
        title: "Xurujlar — odatiy jadvalda",
        text: "Oila har bir xurujni vaqti va davomiyligi bilan alohida yozadi. Siz uchun yozuvlar qog‘oz kundalikdagi kabi oylik «tur × kun vaqti» jadvaliga avtomatik yig‘iladi.",
        colType: "Turi",
        colMorning: "Tong",
        colDay: "Kun",
        colEvening: "Oqshom",
        colNight: "Tun",
        rows: [
          { type: "TK", values: ["1", "·", "·", "1"] },
          { type: "M", values: ["·", "2", "·", "·"] },
          { type: "A", values: ["·", "·", "1", "·"] },
        ],
        caption:
          "Xurujlar jadvali: satrlarda xuruj turi, ustunlarda sutka qismi.",
      },
    },
    rigor: {
      eyebrow: "Klinik qat'iylik",
      h2: "Hisob-kitob — tajriba o‘tkazish joyi emas",
      items: [
        {
          title: "Izolyatsiyalangan hisoblash yadrosi",
          text: "KBJU va nisbatni hisoblash interfeys va API bilan aralashmagan alohida modul tomonidan amalga oshiriladi.",
        },
        {
          title: "Etalon ssenariylar",
          text: "Yadro to‘liq test qamrovi ostida etalon ssenariylar to‘plami bilan tekshiriladi; etalondan og‘ish — relizni to‘xtatish demakdir.",
        },
        {
          title: "Rollar, 2FA, audit jurnali",
          text: "Rollar bo‘yicha kirish: shifokor o‘z bemorlarini, ota-ona o‘z bolasini ko‘radi. Kirish ikkinchi omil bilan himoyalangan, ma’lumotlar bilan amallar qayd etiladi.",
        },
        {
          title: "Kuzatiladigan mahsulotlar bazasi",
          text: "Har bir mahsulotda ma’lumotlar manbai va versiyasi (masalan, USDA FoodData Central) hamda tasdiqlangan sana mavjud.",
        },
        {
          title: "Tayinlovlar o‘zgartirib yozilmaydi",
          text: "Har bir o‘zgarish — muallif va amal qilish sanasiga ega yangi versiya; tarix to‘liq saqlanadi.",
        },
      ],
    },
    onboarding: {
      h2: "Oilaga kirishni siz ochasiz",
      lead: "Mustaqil ro‘yxatdan o‘tish yo‘q: oila KetoCare tizimiga davolovchi shifokor yoki diyetologning taklifi bilan kiradi.",
      items: [
        {
          title: "Qabulda taklifnoma",
          text: "Siz oilaga to‘g‘ridan-to‘g‘ri qabul vaqtida taklifnoma havolasini berasiz — pochta va xabarnomalar shart emas.",
        },
        {
          title: "Oila bola profilini yaratadi",
          text: "Qisqa so‘rovnoma-master: har bir ekranda bittadan savol. Tashxis va dorilarning aniq ro‘yxatini siz kiritasiz.",
        },
        {
          title: "Bemor — sizning ro‘yxatingizda",
          text: "Kundaliklar va menyu darhol ko‘rinadi. Ikkinchi fikr uchun hamkasbni yoki diyetologni yetakchi mutaxassis ulaydi.",
        },
      ],
    },
    pilot: {
      h2: "Pilot qanday o‘tadi",
      items: [
        {
          title: "Kabinet bilan tanishuv",
          text: "Demo ma’lumotlarda shifokor va ota-ona kabinetini ko‘rsatamiz, hisob-kitoblar va me’yorlar bo‘yicha savollarga javob beramiz.",
        },
        {
          title: "Protokollaringiz bilan solishtirish",
          text: "Sizning tayinlov va nazorat ssenariylaringizni tahlil qilamiz; zarurat tug‘ilganda ular hisoblash yadrosining etalon testlariga aylanadi.",
        },
        {
          title: "Birinchi oilalar — birgalikda",
          text: "Sizning kuzatuvingiz ostida birinchi bemorlarni ulaymiz, fikr-mulohazalarni to‘playmiz va aynan sizga xalaqit beradigan jihatlarni takomillashtiramiz.",
        },
      ],
    },
    ctaForm: {
      h2: "Pilot uchun ariza",
      lead: "Ishchi pochtangizni qoldiring — bog‘lanamiz, kabinetni ko‘rsatamiz va klinikangiz uchun pilot formatini muhokama qilamiz.",
      direct: "Yoki to‘g‘ridan-to‘g‘ri yozing:",
    },
  },

  forFamiliesPage: {
    seo: {
      title:
        "Oilalar va ota-onalarga — KetoCare: qiyinchiliklarsiz bolalar ketodiyetasi",
      description:
        "KetoCare oilaga qanday yordam beradi: klinika kodini olish, aniq grammli retseptlar, oshxonada almashtirish kalkulyatori, Telegram Mini App orqali 5 soniyada xurujlarni qayd qilish.",
    },
    hero: {
      eyebrow: "Oilalar va bemorlarga",
      h1: "Oshxonada ishonch va har kuni xotirjamlik",
      lead: "Bolaning ketogenik parhez terapiyasi zargarlik aniqligini talab qiladi. KetoCare murakkab hisob-kitoblar va nazoratni o‘z zimmasiga oladi, shunda siz eng muhim narsaga — bolaga g‘amxo‘rlik qilishga e’tibor qaratishingiz mumkin.",
      ctaCode: "Menda klinika kodi bor",
      ctaApp: "Veb-kabinetni ochish",
    },
    stepsTitle: "Oilaning 4 oddiy qadamdagi yo‘li",
    steps: [
      {
        num: "01",
        title: "Shifokordan shaxsiy kodni olish",
        text: "Qabul vaqtida shifokor maqsadli nisbat va kunlik kaloriyani belgilab, bir martalik faollashtirish kodini beradi. Murakkab ro‘yxatdan o‘tish shart emas.",
      },
      {
        num: "02",
        title: "Tayyor menyu va almashtirishlar kalkulyatori",
        text: "Sof uglevodlarni hisobga olgan holda har bir taom uchun aniq grammlar. Agar mahsulot bo‘lmasa, tizim bir necha soniyada teng o‘rinbosarni hisoblab beradi.",
      },
      {
        num: "03",
        title: "Ketonlar, glyukoza va xurujlarni 5 soniyada yozish",
        text: "O‘lchovlarni veb-kabinet yoki Telegram Mini App orqali kiriting. Xuruj birgina tugmani bosish bilan qayd etiladi («Hozir»), tafsilotlarni keyinroq kiritish mumkin.",
      },
      {
        num: "04",
        title: "Davolovchi shifokor bilan to‘g‘ridan-to‘g‘ri aloqa",
        text: "Barcha ko‘rsatkichlar zudlik bilan bemor xaritasiga uzatiladi. Navbatdagi qabul sanasiga shifokor xotiradan aytilgan gaplarni emas, ob’yektiv grafiklar va hisobotni ko‘radi.",
      },
    ],
    featuresTitle: "Butun oila qulayligi uchun vositalar",
    features: [
      {
        title: "Telegram-bot va Mini App",
        text: "Kundalikning to‘liq imkoniyatlari telefoningizda. Oshxonada noutbukni ochish shart emas — o‘lchovlarni bir necha harakatda yuboring.",
      },
      {
        title: "Bitta tizimda oltita kundalik",
        text: "Qon ketonlari, glyukoza, xurujlar, vazn, dori vositalari va ratsion yagona xronologik tasmada sinxronlashtirilgan.",
      },
      {
        title: "Oilaviy kirish",
        text: "Bola profiliga ikkala ota-onani, buvi yoki enagani ulash mumkin: barcha yozuvlar kelishilgan holda yangilanadi.",
      },
    ],
  },

  methodologyPage: {
    seo: {
      title: "Metodologiya va isbotlangan baza — KetoCare",
      description:
        "KetoCare ilmiy standartlari: izolyatsiya qilingan keto_engine matematik yadrosi, Etvoter formulasi bo‘yicha tekshiruv, 4:1/MAD/LGIT protokollari va 2FA xavfsizligi.",
    },
    hero: {
      eyebrow: "Metodologiya va standartlar",
      h1: "Klinik qat’iylik, matematika va ma’lumotlar xavfsizligi",
      lead: "Dori-darmonlarga chidamli epilepsiya terapiyasi taxminiy hisob-kitoblarni kechirmaydi. Platforma asosiga isbotlangan diyetoterapiyaning qat’iy formulalari va tibbiy sir standartlari kiritilgan.",
    },
    pillarsTitle: "Platformaning me’moriy tamoyillari",
    pillars: [
      {
        num: "01",
        title: "Izolyatsiya qilingan matematik yadro (keto_engine)",
        text: "Ratsionni va grammlarni tanlash bo‘yicha barcha hisob-kitoblarni chiziqli dasturlash (simpleks-usul) asosidagi izolyatsiya qilingan yadro bajaradi. Formulalar qat’iy belgilangan va oraliq yaxlitlashlarga ega emas.",
      },
      {
        num: "02",
        title: "Formula siljishidan himoya va sof uglevodlar",
        text: "Sof uglevodlarni qat’iy hisobga olish (har bir mahsulot bo‘yicha uglevodlardan kletchatkani manfiy bo‘lmagan qiymatda ayirish, ADR-0030) nisbatning klinik buzilishlarini istisno qiladi.",
      },
      {
        num: "03",
        title: "Atwater Checksum va mahsulotlar bazasini tekshirish",
        text: "Har bir mahsulot kaloriyasini Etvoter formulasi (9×Yog‘ + 4×Oqsil + 4×Cnet) bo‘yicha avtomatik tekshirish yorliqdagi xatolarni ular ketozni buzishidan oldin bartaraf etadi.",
      },
      {
        num: "04",
        title: "Tibbiy sir va 2FA xavfsizlik konturi",
        text: "Shifokorlarning majburiy ikki bosqichli autentifikatsiyasi (2FA), ma’lumotlarni qat’iy rollarga ajratish (ota-onalar faqat o‘z bolasini ko‘radi), to‘liq audit va zaxira nusxalarini shifrlash.",
      },
    ],
    protocolsTitle: "Qo‘llab-quvvatlanadigan diyetoterapiya protokollari",
    protocols: [
      {
        name: "Klassik ketogenik parhez (4:1 va 3:1)",
        desc: "Rezistent epilepsiyada diyetoterapiyaning oltin standarti. Yuqori yog‘ miqdori, uglevodlar va oqsillarni qat’iy cheklash.",
      },
      {
        name: "Modifikatsiyalangan Atkins parhezi (MAD)",
        desc: "Oqsillar va kaloriyalarni qat’iy o‘lchamasdan uglevodlarni kuniga 10–20 g gacha cheklash, o‘smirlar uchun juda mos keladi.",
      },
      {
        name: "O‘rtacha zanjirli triglitseridlar parhezi (MCT)",
        desc: "MCT moylaridan foydalanish ketogenezni saqlab qolgan holda ko‘proq uglevodlar va oqsillarni kiritish imkonini beradi.",
      },
      {
        name: "Past glikemik indeksli terapiya (LGIT)",
        desc: "Qon glyukozasi darajasini barqaror saqlash uchun glikemik indeksi 50 dan past bo‘lgan uglevodlarga asosiy e’tibor.",
      },
    ],
  },

  footer: {
    disclaimer:
      "KetoCare — bu shifokor-epileptolog yoki diyetologning qat'iy nazorati ostida parhez terapiyasini klinik kuzatib borish tizimidir. O‘z-o‘zini davolash vositasi emas va shifokor maslahati o‘rnini bosmaydi: tayinlov, ketogenik ratsion va dori vositalarini tuzatish faqat tibbiy guruh tomonidan amalga oshiriladi.",
    sectionsTitle: "Bo‘limlar",
    contactsTitle: "Aloqa",
    adminTitle: "Xodimlar uchun",
    adminLink: "Administrator paneli (/admin)",
    telegram: "Telegram",
    copyright: "© {year} «RailTech» MChJ",
  },
};
