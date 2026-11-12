import type { Dict } from "./ru";

/**
 * English. The structure mirrors `ru.ts` key for key; a missing key is a type
 * error. The product's doctor cabinet is in Russian, so captions of its
 * screenshots say so.
 */
export const en: Dict = {
  common: {
    brand: "KetoCare",
    brandMark: "K",
    skipToContent: "Skip to content",
    openMenu: "Menu",
    closeMenu: "Close",
    mainNav: "Main sections",
    languageLabel: "Site language",
    toggleTheme: "Dark theme",
    grams: "g",
    kcal: "kcal",
    fat: "Fat",
    protein: "Protein",
    carbs: "Carbs",
  },

  nav: {
    home: "Home",
    doctors: "For doctors",
    families: "For families",
    howItWorks: "How it works",
    methodology: "Calculation and safety",
    login: "Log in",
    enterCode: "Enter access code",
    lead: "Send a request",
  },

  shots: {
    overview: {
      alt: "Doctor's cabinet, patient overview: today's totals — ketogenic ratio 3.5 : 1, 1,303 of 1,300 kcal, carbs 11.4 of 14 g; the current prescription on the right.",
      caption:
        "Doctor's cabinet (in Russian): the child's day next to the prescription",
    },
    patients: {
      alt: "Doctor's cabinet, patient list: at the top, children flagged «Prolonged seizure», «No prescription yet», «No readings for 5 days» with a «Remind the family in Telegram» button; below, «No issues».",
      caption: "Patient list (in Russian): those who need attention come first",
    },
    prescription: {
      alt: "Doctor's cabinet, prescription form: ketogenic ratio from a list, calories with a hint by age and weight, protein, carbs, meals, fluid; version history on the right.",
      caption:
        "Prescription (in Russian): hints by age and weight, version history",
    },
    menu: {
      alt: "Doctor's cabinet, weekly menu: four meals a day, the ketogenic ratio and calories under each day.",
      caption: "Weekly menu (in Russian) with totals for each day",
    },
    ketones: {
      alt: "Doctor's cabinet, ketone diary: a one-month chart, ketones rising from 0.8 to 3.1 mmol/L.",
      caption: "Ketone diary for a month (in Russian)",
    },
    seizures: {
      alt: "Doctor's cabinet, seizure diary: a table by day and time of day — morning, afternoon, evening, night — with the number of seizures.",
      caption: "Seizures by day and time of day (in Russian)",
    },
    growth: {
      alt: "Doctor's cabinet, height and weight: position against WHO standards and a table of measurements.",
      caption: "Height and weight against WHO standards (in Russian)",
    },
    appHome: {
      alt: "Telegram app, the family's home screen: prescription 3.5 : 1 and 1,300 kcal, today's totals, latest readings.",
      caption: "Telegram app: home screen",
    },
    appMenu: {
      alt: "Telegram app, today's menu: meal 1 — spinach omelette, the «What to weigh» list is open: egg 53 g, cream 20 g, butter 24 g, spinach 10 g; the first two meals are marked as eaten.",
      caption: "Today's menu: what to weigh and what has been eaten",
    },
    appDiary: {
      alt: "Telegram app, diary: an «Add entry» button, ketone and weight charts for 30 days.",
      caption: "Diary: 30-day charts",
    },
  },

  leadForm: {
    emailLabel: "Email",
    emailPlaceholder: "name@example.com",
    audienceLegend: "Who are you",
    audienceDoctor: "Doctor or clinic",
    audienceFamily: "Family",
    submit: "Send request",
    sending: "Sending…",
    errorEmail: "Please check the email address — it looks like a typo.",
    errorNetwork:
      "We could not send your request. Please try again or write to {email}.",
    errorRateLimited:
      "There have been many requests from your address. Please write to {email}.",
    doneTitle: "Request sent",
    doneText:
      "The KetoCare administrator will receive it. Reply address: {email}.",
    again: "Use a different address",
    consent:
      "We use the address only to reply to your request. Please do not write anything about the child's health in the form.",
  },

  home: {
    seo: {
      title:
        "KetoCare — ketogenic diet for a child with epilepsy: doctor and family",
      description:
        "The doctor sets the prescription, the family cooks by the gram and keeps diaries in Telegram, the doctor sees how the therapy goes. A web cabinet and a Telegram app.",
    },
    hero: {
      h1: "Ketogenic diet for a child with epilepsy: doctor and family in one system",
      lead: "The doctor sets the prescription. The family cooks by the gram and keeps the diary on the phone. The doctor sees how the therapy is going — no notebooks and no manual recalculation.",
      ctaPrimary: "Send a request",
      ctaSecondary: "How it works",
      codeHint: "Has your doctor already given you an access code?",
    },
    doctor: {
      h2: "What the doctor gets",
      items: [
        "A prescription in a minute — with a calorie hint by age and weight.",
        "A patient list that puts first those who need attention.",
        "The family's diaries with charts: seizures, ketones, weight, wellbeing, medications, meals.",
        "Growth against WHO standards, follow-up visits, PDF reports.",
        "Printing of the prescription and the menu for the family.",
      ],
      more: "More for doctors",
    },
    family: {
      h2: "What the family gets",
      items: [
        "A daily menu: how many grams of each product to weigh.",
        "A dish check against the child's prescription and fitting grams to the target.",
        "A diary in a couple of taps in Telegram, and reminders.",
        "An assistant that answers questions about how the app works.",
        "Access for the second parent or a grandmother. Russian and Uzbek.",
      ],
      more: "More for families",
    },
    steps: {
      h2: "How it works",
      items: [
        {
          title: "The doctor creates the card",
          text: "And sets the prescription: ketogenic ratio, calories, protein, carbs, meals per day.",
        },
        {
          title: "The family gets a code",
          text: "Eight characters or a QR code. It opens in the KetoCare Telegram bot, no password needed.",
        },
        {
          title: "The family runs the therapy at home",
          text: "Plans the menu, weighs by the gram, marks what was eaten, keeps the diaries.",
        },
        {
          title: "The doctor sees the dynamics",
          text: "Every day, not only at the visit. The family sees a new prescription at once.",
        },
      ],
      more: "More about each step",
    },
    safety: {
      h2: "Safety",
      items: [
        {
          title: "The doctor decides",
          text: "Only the doctor sets the prescription. The app does not change it or advise instead of the doctor.",
        },
        {
          title: "Every dish is checked",
          text: "The dish and the whole day are compared with the prescription.",
        },
        {
          title: "The assistant does not treat",
          text: "It answers only about how the app works. Health questions go to the doctor.",
        },
        {
          title: "Access by role",
          text: "A family sees its own child, a doctor their own patients. The administrator does not see medical data.",
        },
      ],
      more: "How dishes are calculated and data is protected",
    },
    faq: {
      h2: "Frequently asked questions",
      items: [
        {
          q: "Can we use it without a doctor?",
          a: "No. The doctor sets the prescription, and without it the app has nothing to calculate against. If your doctor does not use KetoCare yet, send a request or tell them about it.",
        },
        {
          q: "What does a family need to start?",
          a: "Telegram on the phone and an access code from the doctor. Nothing to install. A web cabinet can be turned on later if needed.",
        },
        {
          q: "Which languages?",
          a: "The bot and the Telegram app are in Russian and Uzbek. The doctor's cabinet is in Russian.",
        },
        {
          q: "Does the app give medical advice?",
          a: "No. It calculates dishes against the doctor's prescription and keeps the family's records. The assistant only answers questions about how the app works.",
        },
        {
          q: "How can a clinic join?",
          a: "Send a request at the bottom of the page — the KetoCare administrator will receive it.",
        },
      ],
    },
    lead: {
      h2: "Send a request",
      text: "For clinics and doctors who want to follow children in KetoCare, and for families with questions.",
    },
  },

  doctors: {
    seo: {
      title: "KetoCare for doctors and dietitians",
      description:
        "Prescriptions with hints by age and weight, a patient list by urgency, the family's diaries, growth against WHO standards, follow-up visits and reports.",
    },
    hero: {
      h1: "What doctors and dietitians get",
      lead: "Prescription, menu, the family's diaries and the child's dynamics — in one cabinet. The family gets your prescription at once, and you see its records every day.",
    },
    patients: {
      title: "Children who need attention come first",
      text: "The patient list moves to the top those for whom something is wrong.",
      points: [
        "A prolonged seizure in the past week.",
        "No prescription yet, or the family has not connected.",
        "The family has recorded nothing for several days — with a «Remind the family in Telegram» button.",
        "The day's ketogenic ratio differs from the prescription.",
      ],
    },
    prescription: {
      title: "A prescription in a minute",
      text: "The ketogenic ratio is chosen from a list — from 1 : 1 to 5 : 1 in steps of 0.5.",
      points: [
        "A calorie hint by the child's age and weight.",
        "The carb limit is calculated automatically and can be changed.",
        "Protein, meals per day and, if needed, fluid.",
        "Every change is a new version. The history is kept.",
        "The prescription and the menu print for the family with one button.",
      ],
    },
    menu: {
      title: "Menus and dishes that match the prescription",
      text: "The menu can be planned by the family, the doctor or the dietitian — everyone sees the same thing.",
      points: [
        "Every dish and the whole day are checked against the prescription.",
        "The whole week at once, with each day's ketogenic ratio and calories.",
        "The calculator fits product grams to the meal target.",
        "If the doctor planned the menu, the family gets a Telegram message.",
      ],
    },
    diaries: {
      title: "The family's diaries — every day",
      text: "Six diaries: seizures, ketones, weight, wellbeing, medications, meals. The family records them in Telegram or in the cabinet.",
      points: [
        "Charts for a week, a month or any period.",
        "Seizures as a table by day and time of day.",
        "The doctor can add records made at the visit.",
      ],
    },
    growth: {
      title: "Growth, visits, reports",
      text: "Everything needed for the visit is ready in advance.",
      points: [
        "Height and weight against WHO standards, with a flag for a notable drop.",
        "Follow-up visits at 1, 3, 6, 9, 12 and 24 months; the family gets a reminder three days before.",
        "A PDF report for any period.",
        "AI prepares a draft summary for the period. Only text the doctor has checked and approved goes into the report.",
      ],
    },
    connect: {
      h2: "How to connect a family",
      items: [
        {
          title: "You create the card",
          text: "At the visit: questionnaire, prescription, medications. You can work with the card right away.",
        },
        {
          title: "The family gets a code",
          text: "Eight characters and a QR code. The code is valid for a week and can be revoked.",
        },
        {
          title: "The family opens it in Telegram",
          text: "Or in a browser. No password. The family invites a second adult itself.",
        },
      ],
    },
    lead: {
      h2: "Connect a clinic",
      text: "Leave your work email — the KetoCare administrator will receive the request.",
    },
  },

  families: {
    seo: {
      title: "KetoCare for families: menu, grams and a diary in Telegram",
      description:
        "A menu from the doctor's prescription with grams for each product, dish checks, a diary in Telegram, reminders and an assistant. In Russian and Uzbek.",
    },
    hero: {
      h1: "What the family gets",
      lead: "The doctor's prescription turns into clear grams in the kitchen, and the diary into a couple of taps in Telegram. The doctor sees the records without waiting for the next visit.",
      codeCta: "I have a code",
    },
    start: {
      title: "How to start",
      points: [
        "The doctor creates the child's card and gives you an access code — eight characters or a QR code.",
        "Send the code to the KetoCare Telegram bot — and the app opens.",
        "No sign-up and no password. A web cabinet can be turned on later.",
      ],
    },
    menu: {
      title: "Menu and grams",
      text: "The menu for yesterday, today and tomorrow. You or the doctor plan it.",
      points: [
        "Every dish has «What to weigh»: the grams of each product.",
        "Mark a dish as eaten with one tap.",
        "Day totals next to the prescription: calories, carbs, ketogenic ratio.",
        "«Same as yesterday» copies yesterday's menu into an empty day.",
      ],
    },
    calc: {
      title: "Check your own dish",
      text: "Build a dish from products — the app tells you at once whether it fits the prescription. It can also fit the grams to the meal target. Try it on an example:",
    },
    diary: {
      title: "A diary in a couple of taps",
      text: "Six diaries: seizures, ketones, weight, wellbeing, medications, meals.",
      points: [
        "The bot records in a few seconds and repeats what was recorded, so mistakes are easy to spot.",
        "You can describe what the child ate in words — the bot shows the products and grams and records only after you confirm.",
        "Reminders come at the time you choose — only if there is no record for the day yet.",
        "Charts of ketones, weight and seizures for 30 days.",
      ],
    },
    help: {
      title: "The assistant and the whole family",
      points: [
        "The assistant answers questions about using the app, from reviewed articles. It gives no medical advice.",
        "You can invite the second parent, a grandmother or a nanny — they see the same child.",
        "One Telegram account can follow several children.",
        "The bot and the app are in Russian and Uzbek.",
      ],
    },
    end: {
      h2: "Your doctor does not use KetoCare yet?",
      text: "Tell them about it or send a request.",
    },
  },

  calc: {
    dish: "Omelette with cream and broccoli",
    target: "Example prescription: 3.5 : 1",
    ingredients: ["Chicken egg", "Cream 33%", "Butter", "Broccoli"],
    sliderLabel: "{name}, grams",
    netCarbs:
      "Carbs minus fibre: {value} — the ketogenic ratio is calculated from these.",
    verdictOk: "Fits the prescription",
    verdictLow: "Too little fat for the prescription",
    verdictHigh: "More fat than the prescription",
    disclaimer:
      "This is an example with four products. The real prescription is set by the doctor.",
  },

  how: {
    seo: {
      title: "How KetoCare works",
      description:
        "Four steps: the doctor creates the card and prescription, the family gets a code, keeps the menu and diaries in Telegram, the doctor sees the dynamics.",
    },
    hero: {
      h1: "How it works",
      lead: "From the first visit to daily work at home — what the doctor does, what the family does and where it happens.",
    },
    steps: [
      {
        who: "Doctor",
        title: "Creates the card and sets the prescription",
        points: [
          "The child's questionnaire, medical data, medication schedule.",
          "Prescription: ketogenic ratio, calories, protein, carb limit, meals per day.",
          "A calorie hint by age and weight.",
        ],
      },
      {
        who: "Doctor and family",
        title: "The family gets access",
        points: [
          "The doctor issues an access code — eight characters and a QR code. It is valid for a week.",
          "The family sends the code to the KetoCare Telegram bot or enters it in the web cabinet.",
          "No password. The family invites a second adult itself.",
        ],
      },
      {
        who: "Family",
        title: "Runs the therapy at home",
        points: [
          "Plans the menu from dishes and recipes — the app checks every dish against the prescription.",
          "Weighs products by the grams in the menu and marks what was eaten.",
          "Records seizures, ketones, weight, wellbeing and medications taken.",
          "Gets reminders at the chosen time.",
        ],
      },
      {
        who: "Doctor",
        title: "Sees the dynamics and changes the prescription",
        points: [
          "The patient list shows first those who need attention.",
          "Charts, growth against WHO standards, follow-up visits, PDF reports.",
          "The family sees a new prescription at once and gets a Telegram message.",
        ],
      },
    ],
    channels: {
      h2: "Where it works",
      items: [
        {
          title: "Web cabinet",
          text: "For doctors and dietitians — all work with patients. For families — optional, if a computer is more convenient.",
        },
        {
          title: "Telegram bot",
          text: "Quick diary records, reminders, messages about a new prescription or menu.",
        },
        {
          title: "Telegram app",
          text: "Opens with a button in the chat with the bot: menu, dish calculation, recipes, diary, assistant.",
        },
      ],
    },
    roles: {
      h2: "Who sees what",
      items: [
        {
          title: "Doctor",
          text: "Their own patients: prescription, medications, diaries, reports.",
        },
        {
          title: "Dietitian",
          text: "Their own patients: prescription, menu, recipes and products. Medical data is read-only.",
        },
        {
          title: "Family",
          text: "Only its own child: prescription, menu, diaries, assistant.",
        },
        {
          title: "Clinic administrator",
          text: "Staff accounts and requests. No access to medical data.",
        },
      ],
    },
    more: {
      text: "How the app calculates dishes and protects data —",
      link: "on a separate page",
    },
  },

  methodology: {
    seo: {
      title: "How KetoCare calculates dishes and protects data",
      description:
        "The ketogenic ratio and calories in plain words, product checks, the doctor's role, the assistant and data protection.",
    },
    hero: {
      h1: "Calculation and safety",
      lead: "In plain words: how the app checks dishes, who makes decisions and how the child's data is protected.",
    },
    sections: [
      {
        title: "How a dish is checked",
        points: [
          "The ketogenic ratio is how many grams of fat there are per gram of protein and carbs together. With a 4 : 1 prescription, there are 4 g of fat for every 1 g of protein and carbs.",
          "Fibre does not count towards the ratio: it is subtracted from each product's carbs. The daily carb limit counts all carbs.",
          "Salt and pepper are listed in the recipe but not counted.",
          "The dish and the whole day are compared with the prescription. If they differ by more than allowed, the app warns.",
        ],
      },
      {
        title: "Where product data comes from",
        points: [
          "Each product in the catalogue has fat, protein, carbs, fibre and calories per 100 g, and the source of these figures.",
          "A product's calories are checked against its fat, protein and carbs. If the figures do not add up, the catalogue warns.",
          "The catalogue is maintained by the clinic's dietitians.",
        ],
      },
      {
        title: "Who makes decisions",
        points: [
          "Only the doctor sets and changes the prescription. Every change is a new version; earlier ones stay in the history.",
          "The app does not diagnose, does not change the diet and does not advise on treatment.",
          "If a parent describes in words what the child ate, the app shows the recognised products and grams. The record appears only after confirmation.",
          "AI prepares a draft summary for the doctor. Only text the doctor has checked and approved goes into the report.",
        ],
      },
      {
        title: "The assistant",
        points: [
          "Answers only questions about how the app works, and only from reviewed articles. If there is no suitable article, it says so.",
          "It does not answer about medicines, doses, symptoms or diet changes — it refers you to the doctor.",
          "Under every answer it reminds you that this is not medical advice. The doctor sees the family's questions.",
        ],
      },
      {
        title: "How data is protected",
        points: [
          "A family sees only its own child, a doctor only their own patients. The administrator does not see medical data.",
          "Doctors log in with a password and a code from an app on their phone.",
          "Names and contacts are not sent to the AI.",
          "Medical records are never silently erased; backups are stored encrypted.",
        ],
      },
    ],
  },

  notFound: {
    seo: {
      title: "Page not found — KetoCare",
      description: "There is no such page on the KetoCare site.",
    },
    h1: "This page does not exist",
    text: "The address may be mistyped or the page may have moved. Start from one of the sections:",
  },

  footer: {
    disclaimer:
      "KetoCare helps run ketogenic diet therapy under a doctor's supervision. The app does not diagnose and does not replace a consultation: the prescription and its changes are the doctor's decision.",
    sectionsTitle: "Sections",
    cabinetTitle: "Cabinet",
    contactsTitle: "Contacts",
    telegram: "Telegram",
    copyright: "© {year} LLC 'RailTech'",
  },
};
