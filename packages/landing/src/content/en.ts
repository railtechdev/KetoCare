/**
 * Английская версия словаря лендинга.
 *
 * Структура обязана в точности повторять `ru.ts` (тип `Dict`): недостающий или
 * лишний ключ — ошибка `astro check`. Формулировки правятся здесь, не в разметке.
 */

import type { ChatMsg, Dict, HowStep, Level, QueueItem } from "./ru";

export const en: Dict = {
  /** Подписи интерфейса, общие для всех страниц. */
  common: {
    brand: "KetoCare",
    /** Буква в квадрате логотипа: у латиницы и кириллицы она разная. */
    brandMark: "K",
    skipToContent: "Skip to content",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    languageLabel: "Site language",
    grams: "g",
    kcal: "kcal",
    fat: "Fat",
    protein: "Protein",
    carbs: "Carbs",
  },

  nav: {
    howItWorks: "How it works",
    doctors: "For clinicians",
    login: "Log in",
    earlyAccess: "Early access",
    pilot: "Request a pilot",
    home: "Home",
  },

  /** Форма заявки — одна на два места (семьям и врачам). */
  leadForm: {
    emailLabel: "Email address",
    emailPlaceholderFamily: "Email",
    emailPlaceholderDoctor: "Work email",
    submitFamily: "Request access",
    submitDoctor: "Send",
    sending: "Sending…",
    errorEmail: "Please check the address — it looks like there is a typo.",
    errorNetwork:
      "We could not send your request. Please try again or write to us by email.",
    errorRateLimited: "Too many requests from your address. Write to us at {email}.",
    doneFamily: "Got it. We will write to {email} and help you get set up.",
    doneDoctor:
      "Your request is in. We will reply to {email} within the next few days.",
    consent:
      "By sending this form you agree that we may contact you at the address you provide. Please do not include medical data in the form.",
  },

  home: {
    seo: {
      title: "KetoCare — ketogenic diet therapy under clinical supervision",
      description:
        "Ketogenic diet therapy support for children with drug-resistant epilepsy: meals calculated to the prescription, six diaries, trends for the clinician.",
    },
    hero: {
      badge: "The platform is live and evolving",
      h1: "A child's ketogenic diet, exactly as prescribed",
      lead: "KetoCare helps families of children with drug-resistant epilepsy follow ketogenic diet therapy: it calculates meals, keeps the diaries and shows the clinician what happened between visits.",
      ctaFamily: "Early access for families",
      ctaDoctors: "For clinicians and clinics",
      chips: [
        "By prescription only",
        "Calculations checked against reference cases",
        "Web + Telegram",
      ],
      /** Иллюстрация: главный экран кабинета родителя. */
      card: {
        today: "Today",
        childName: "Anna · 7 years old",
        childInitials: "AR",
        nextMeal: "Next meal · 12:30",
        ratio: "3.50 : 1",
        dish: "Omelette with cream and broccoli",
        dishMacros: "310 kcal · fat 29.4 g · protein 6.8 g · carbs 1.6 g",
        dayVsPrescription: "Day against the prescription",
        caloriesLabel: "Calories",
        caloriesValue: "742 / 1200 kcal",
        fatValue: "68.2 g",
        proteinValue: "17.1 g",
        carbsValue: "7.7 g",
        carbsLeft: "Carbs left for today: <strong>4.3 g</strong> of 12",
        quickKetones: "+ Ketones",
        quickWeight: "+ Weight",
        quickSeizure: "Seizure",
        caption: "The parent workspace — this is the home screen",
      },
    },
    mission: {
      eyebrow: "Mission",
      h2: "So that therapy at home is followed as precisely as in the clinic",
      lead: "Ketogenic diet therapy may help some of the children for whom medication did not work — but only when it is followed precisely. Between visits the family is left alone with the arithmetic. KetoCare brings the family and the clinician into one loop: the prescription, the calculations, the diaries and the trends live in one system.",
      families: {
        title: "What families can expect",
        items: [
          "Every meal calculated to the prescription — no calculator, no notebook",
          "A day's menu and six diaries — a couple of taps, from a phone",
          "The clinician sees the trends between visits — you are not on your own",
        ],
      },
      doctors: {
        title: "What clinicians can expect",
        items: [
          "Versioned prescriptions with tolerances — history is never rewritten",
          "A patient list ordered by risk and a chart with trends",
          "A visit report built from the family's entries — a conversation based on data, not recollection",
        ],
      },
    },
    steps: {
      eyebrow: "How it is set up",
      h2: "Three roles, one diary, no arithmetic in the kitchen",
      items: [
        {
          title: "The clinician sets the prescription",
          text: "Ketogenic ratio, daily calories, protein target and carb limit — all in one place, with the date it takes effect.",
        },
        {
          title: "The family follows it",
          text: "The platform calculates meals and menus against the prescription and says right away whether the day matches. Diary entries take a couple of taps, from the web or Telegram.",
        },
        {
          title: "The clinician sees the trends",
          text: "Ketones, weight, seizures and food — in the patient chart. The visit starts from a ready report instead of a notebook and recollection.",
        },
      ],
      link: "More about each step",
    },
    calc: {
      eyebrow: "Try it yourself",
      h2: "Build a breakfast for a 3.5 : 1 prescription",
      lead1:
        "The ketogenic ratio is fat against protein and carbs together. Every meal has to land on the prescribed ratio within the tolerance.",
      lead2:
        "Move the sliders — the calculation is instant. In real life the platform does this, so there is no scale-calculator-notebook routine at every meal.",
      note: "Food data comes from USDA FoodData Central. In the product the calculation runs in an isolated engine checked against reference cases that are themselves computed from the formulas in the specification. Confirmation by the medical team is still ahead.",
      dish: "Omelette with cream and broccoli",
      ingredients: ["Egg", "Cream 33%", "Butter", "Broccoli"],
      /** Видимая оговорка: посетитель не должен считать этим завтрак ребёнку. */
      disclaimer:
        "This is a demonstration of the formula, not a meal-planning tool. A child's meals are calculated in the workspace, against the prescription currently in effect.",
      /** Подпись ползунка для читателя с экранного диктора: «Яйцо куриное, граммы». */
      sliderLabel: "{name}, grams",
      verdictOk:
        "Matches the 3.5 : 1 prescription (preliminary tolerance ±0.15)",
      verdictLow: "Below the prescription — add fat or remove carbs",
      verdictHigh: "Above the prescription — more fat than prescribed",
    },
    diaries: {
      eyebrow: "Diaries",
      h2: "Six diaries — a couple of taps each",
      lead: "Seizures, ketones, weight, food, medication and wellbeing. Everything the family records — from the web, the bot or the mini app — lands in one diary and is visible to the clinician.",
      ketones: {
        title: "Ketones over 14 days",
        badge: "3.5 mmol/L",
        caption: "Reaching ketosis shows up on the chart, not by feel",
        chartAlt:
          "Ketone chart over 14 days: the value rises steadily from 1.2 to 3.5 mmol/L.",
      },
      seizure: {
        title: "Log the seizure now, add the details later",
        text: "Nobody fills in a form during a seizure. The entry takes one or two taps: the type and “now”. Triggers and a description can be added later, once things are calm. For the clinician the entries assemble themselves into the familiar monthly grid by seizure type.",
        chipType: "Tonic-clonic",
        chipNow: "Now",
      },
      progress: {
        title: "Progress means “left”, not “eaten”",
        text: "“4.3 g of carbs left for today” is an answer, not an arithmetic problem. A warning appears only when the day genuinely departs from the prescription.",
      },
    },
    telegram: {
      eyebrow: "Telegram",
      h2: "Log entries straight from the messenger",
      lead: "A ketone reading is one message to the bot. The bot and the mini app are part of the platform: everything lands in the same diary and is visible to the clinician. The bot is being released step by step, so some of the scenarios below already work and some are on the way.",
      items: [
        "Ketones, weight and wellbeing — 2–4 taps, with buttons",
        "Coming: food in plain text — the AI parses it, you confirm it",
        "Coming: reminders for measurements and medication",
        "Coming: the parent workspace as a mini app inside Telegram",
      ],
      botLabel: "bot",
      replay: "Play again",
      caption:
        "A scripted demo. The bot does not give therapy advice — only quick entries and reminders",
      chat: [
        { from: "user", text: "ketones 2.6", time: "08:11" },
        {
          from: "bot",
          text: "Ketones 2.6 mmol/L. How did you measure them?",
          time: "08:11",
          chips: ["Blood", "Urine"],
        },
        { from: "user", text: "Blood", time: "08:12" },
        {
          from: "bot",
          text: "Saved ✓ Ketones 2.6 mmol/L (blood), today at 08:12. It is in the diary — the clinician will see it.",
          time: "08:12",
        },
        { from: "user", text: "weight 21.4", time: "14:05" },
        {
          from: "bot",
          text: "Weight 21.4 kg. Log it for today?",
          time: "14:05",
          chips: ["Yes, today", "Another date"],
        },
        { from: "user", text: "Yes, today", time: "14:05" },
        {
          from: "bot",
          text: "Saved ✓ Weight 21.4 kg, today. Your clinician will see the trend.",
          time: "14:06",
        },
      ] as ChatMsg[],
    },
    doctorsTeaser: {
      eyebrow: "For clinicians and dietitians",
      h2: "Not “how many patients”, but who needs you today",
      lead: "The patient list is ordered by risk: a family gone quiet, a day outside the tolerance, more seizures than the week before. Trends and diaries live in the patient chart, and the visit report is built from the family's entries.",
      cta: "A closer look at the clinician workspace",
      queueTitle: "Needs attention",
      queue: [
        {
          name: "Michael K.",
          status: "no data",
          reason: "No diary entries for 4 days",
          age: "4 days ago",
          level: "danger",
        },
        {
          name: "Anna R.",
          status: "nutrition",
          reason: "Third day in a row outside the tolerance",
          age: "data from today",
          level: "warning",
        },
        {
          name: "Vera S.",
          status: "seizures",
          reason: "More seizures than the week before",
          age: "data from yesterday",
          level: "warning",
        },
      ] as QueueItem[],
      queueNote:
        "The status is always spelled out in words — colour is never the only signal",
    },
    trust: {
      eyebrow: "Why this can be trusted",
      h2: "A calculation error is a clinical risk. We design from that.",
      items: [
        {
          title: "Calculations are checked against reference cases",
          text: "The calculation engine is isolated from the rest of the code and is checked against a set of reference cases on every change. The reference cases themselves are computed from the formulas in the specification and are still awaiting confirmation by the medical team.",
        },
        {
          title: "Role-based access",
          text: "A parent sees their own child, a clinician sees their own patients. Log-in is protected by a second factor, and operations on data are written to the audit log.",
        },
        {
          title: "The AI does not decide for people",
          text: "The AI assistant arrives at the next stage, and it is already designed this way: it parses plain text and drafts summaries, but every entry is confirmed by a person, and neither names nor contacts ever reach the requests.",
        },
        {
          title: "Your choice of channel",
          text: "The web workspace, the Telegram bot and the mini app all write to the same diary. The family uses whichever suits the day.",
        },
      ],
    },
    faq: {
      h2: "Frequent questions",
      items: [
        {
          q: "Is KetoCare right for us?",
          a: "The platform is built for families whose clinician has prescribed ketogenic diet therapy — usually for children with drug-resistant epilepsy. The diet must never be started without a clinician, and the platform does not offer that.",
        },
        {
          q: "Does this replace a clinician or a dietitian?",
          a: "No. Only the treating team sets and changes the prescription. KetoCare helps you follow it precisely at home and keeps the clinician informed about what happens between visits.",
        },
        {
          q: "What does it cost?",
          a: "The platform is growing together with its first families and clinics; terms are discussed individually — leave your contact and we will explain everything.",
        },
        {
          q: "What do we need to get started?",
          a: "An invitation from your treating clinician: at the visit they give you a link, you create the child's profile and fill in a short questionnaire — one question per screen. If your clinician does not work with KetoCare yet, leave your contact and we will help introduce them to the platform.",
        },
        {
          q: "Can both parents make entries?",
          a: "Yes. A child can have several adults — two parents, a grandparent, a guardian — and each keeps the diaries from their own account. One parent can also care for several children.",
        },
        {
          q: "Where is our child's data kept?",
          a: "Access is strictly role-based: a parent sees their own child, a clinician sees their own patients, and the system administrator has no access to clinical data at all. Log-in is protected by a second factor, and actions on data are recorded in the audit log. At the family's request the data is deleted completely.",
        },
      ],
    },
    cta: {
      h2: "Let's get acquainted",
      lead: "The platform is already running and continues to grow. A family's access is opened by their treating clinician; clinicians and clinics we connect directly.",
      family: {
        eyebrow: "For families",
        title: "Access for your family",
        text: "Access is opened by your treating clinician, with an invitation at the visit. If your clinician is not with us yet, leave your email: we will help introduce them to the platform.",
      },
      doctors: {
        eyebrow: "For clinicians and clinics",
        title: "Request a pilot",
        text: "We will show you the clinician workspace, go through your clinic's protocols and onboard the first patients together with you.",
        cta: "Details and request",
      },
    },
  },

  howItWorks: {
    seo: {
      title: "How KetoCare works — from prescription to report",
      description:
        "Five steps of ketogenic diet therapy in KetoCare: the clinician sets the prescription, the family builds meals and keeps diaries, the clinician sees trends.",
    },
    hero: {
      eyebrow: "How it works",
      h1: "From prescription to report — one loop",
      lead: "The clinician, the family and the data work in one system. Nothing is copied out of a notebook, recalculated by hand or lost between visits.",
    },
    steps: [
      {
        role: "Clinician",
        title: "Invites the family and sets the prescription",
        paragraphs: [
          "Access is opened by the treating clinician: at the visit they hand over an invitation link. With it the parent creates the child's profile and fills in a short questionnaire — one question per screen; the diagnosis and the exact list of medications are entered by the clinician.",
          "Then comes the prescription: ketogenic ratio, daily calories, protein target and carb limit, with the date it takes effect. Every change is a new version, and the history is kept in full.",
        ],
        chips: ["3.5 : 1", "1200 kcal/day", "protein 25 g", "carbs ≤ 12 g"],
      },
      {
        role: "Family",
        title: "Builds the menu without arithmetic",
        paragraphs: [
          "The parent picks foods and weights — the platform instantly calculates calories, macros and the ratio, and says whether the meal lands on the prescription. Entering food starts from “Recent” and “Frequent”, not from an empty search box.",
        ],
        verdictBadge: "3.52 : 1",
        verdictText: "Matches the prescription · preliminary tolerance ±0.15",
        chips: [],
      },
      {
        role: "Family",
        title: "Keeps the diaries in a couple of taps",
        paragraphs: [
          "Seizures, ketones, weight, food, medication and wellbeing — from the web or in a short message to the Telegram bot. Food can be described in plain text: the AI parses what was eaten and you confirm it. A seizure is logged straight away in one or two taps — the type and “now”, with the details later. Nobody fills in forms during a seizure.",
        ],
        chips: ["+ Ketones", "+ Weight", "+ Medication", "Seizure — now"],
      },
      {
        role: "Clinician",
        title: "Sees the trends between visits",
        paragraphs: [
          "Ketones, weight, seizures and food on a single timeline, with markers where the prescription changed. Patients who need attention rise to the top of the list on their own: a family gone quiet, a day outside the tolerance, more seizures than the week before.",
        ],
        chips: [],
      },
      {
        role: "Together",
        title: "The visit runs on data, not on memory",
        paragraphs: [
          "A summary for the period is ready before the visit: how the measurements moved, the seizures, how closely the prescription was followed. The conversation starts from facts, and the clinician decides on any adjustment.",
        ],
        chips: [],
      },
    ] as HowStep[],
    channels: {
      h2: "One diary, four channels",
      lead: "Wherever the family makes an entry, the data lands in one place and is visible to the clinician.",
      items: [
        {
          title: "Web workspace",
          text: "Workspaces for the parent, the clinician, the dietitian and the administrator. Menus, diaries, the patient chart, reports.",
        },
        {
          title: "Telegram bot",
          text: "Quick diary entries in short messages, plus reminders for measurements.",
        },
        {
          title: "Mini app",
          text: "The parent workspace inside Telegram — with no separate app to install.",
        },
        {
          title: "AI assistant",
          text: "It parses plain text (“we had an omelette and half a glass of cream”) and drafts summaries. Every entry is confirmed by a person. It gives no therapy advice — those questions go to the clinician.",
        },
      ],
    },
    status: {
      eyebrow: "Project status",
      h2: "The core features already work",
      nowTitle: "Working today",
      now: [
        "Workspaces for the parent, the clinician and the administrator",
        "A calculation engine with reference tests",
        "Prescriptions, the food database, menus and six diaries",
        "Log-in with 2FA, access roles, audit log",
      ],
      nextTitle: "In progress",
      next: [
        "The Telegram bot and reminders",
        "The mini app inside Telegram",
        "The family's AI assistant and draft summaries",
      ],
      note: "There is no open sign-up by design: a family's access is opened by their treating clinician, and clinicians and clinics we connect directly.",
    },
    cta: {
      h2: "See it on your own case",
      lead: "For families — the early-access waiting list. For clinicians and clinics — a pilot with a walkthrough of the workspace.",
    },
  },

  doctors: {
    seo: {
      title: "KetoCare for clinicians and dietitians — ketogenic therapy",
      description:
        "KetoCare clinician workspace: patients ranked by risk, trends in ketones, weight and seizures, a visit report, versioned prescriptions. Pilot for clinics.",
    },
    hero: {
      eyebrow: "For clinicians and dietitians",
      h1: "The prescription is being followed. You can see how.",
      lead: "Between visits the family is on its own: weighing, calculating, writing in a notebook. KetoCare moves the day-to-day of the prescription into a controlled loop — you see trends and deviations instead of a recollection once every three months.",
      ctaPilot: "Request a pilot",
      ctaHow: "How the loop is built",
      card: {
        title: "Prescription · Anna R.",
        badge: "active since Aug 16",
        ratioLabel: "Ratio",
        ratioValue: "3.5 : 1",
        caloriesLabel: "Calories",
        caloriesValue: "1200 kcal",
        proteinLabel: "Protein",
        proteinValue: "25 g/day",
        carbsLabel: "Carbs",
        carbsValue: "≤ 12 g/day",
        mealsLabel: "Meals per day",
        mealsValue: "4",
        note: "The family sees these targets in their own workspace; every meal and every day is checked against them automatically, with a tolerance on the ratio — preliminary for now, ±0.15, and being refined together with the medical team.",
      },
    },
    benefits: {
      h2: "A working day, not a wall of metrics",
      queue: {
        title: "Needs attention",
        text: "The patient list is ordered by risk, not alphabetically: a family gone quiet, nutrition outside the tolerance, more seizures than the week before. Each row shows the name, the status in words and in colour, the reason and how recent the data is.",
        rows: [
          {
            name: "Michael K.",
            reason: "no diary entries for 4 days",
            level: "danger",
          },
          {
            name: "Anna R.",
            reason: "3rd day in a row outside the tolerance",
            level: "warning",
          },
        ] as { name: string; reason: string; level: Level }[],
      },
      chart: {
        title: "Patient chart",
        text: "Ketones, weight, seizures, food and medication on a single timeline, with markers where the prescription changed: you can see what happened after the adjustment.",
        legend: "prescription change 3.0 → 3.5",
        chartAlt:
          "A measurement charted over time: a gentle rise that becomes noticeably steeper after the prescription-change marker.",
      },
      report: {
        title: "Visit report",
        text: "The summary for the period between visits is built from the family's entries: trends, seizures, how closely the prescription was followed. The draft is prepared by the AI from de-identified data — no names, no contacts; only text approved by the clinician goes into the report. Export as PDF and CSV.",
        sampleTitle: "Summary · Aug 16 — Aug 30",
        sampleLines: [
          "Ketones: median 2.8 mmol/L · Weight: −0.3 kg",
          "Seizures: 4 (7 in the previous period)",
          "Days within the ratio tolerance: 11 of 14",
        ],
      },
      grid: {
        title: "Seizures in the familiar grid",
        text: "The family logs each seizure separately, with the time and the duration. For you the entries assemble themselves into a monthly “type × time of day” grid, just like the paper diary.",
        colType: "Type",
        colMorning: "Morning",
        colDay: "Day",
        colEvening: "Evening",
        colNight: "Night",
        rows: [
          { type: "TC", values: ["1", "·", "·", "1"] },
          { type: "M", values: ["·", "2", "·", "·"] },
          { type: "A", values: ["·", "·", "1", "·"] },
        ],
        caption:
          "Seizure grid: seizure type down the rows, time of day across the columns.",
      },
    },
    rigor: {
      eyebrow: "Clinical rigour",
      h2: "Calculation is no place for improvisation",
      items: [
        {
          title: "An isolated calculation engine",
          text: "Calories, macros and the ratio are computed by a separate module, kept apart from the interface and the API. It cannot be “quickly tweaked” from neighbouring code.",
        },
        {
          title: "Reference cases",
          text: "The engine is checked against a set of reference cases with full test coverage; a divergence from a reference case stops the release. For now the reference cases are computed from the formulas in the specification, and we align them with your clinic.",
        },
        {
          title: "Roles, 2FA, audit log",
          text: "Role-based access: a clinician sees their own patients, a parent sees their own child. Log-in uses a second factor, and operations on data are recorded.",
        },
        {
          title: "A traceable food database",
          text: "Every food carries its source and data version (USDA FoodData Central, for example) and the date it was verified. Calculations never rest on numbers found somewhere online.",
        },
        {
          title: "Prescriptions are never rewritten",
          text: "Every change is a new version with an author and an effective date; the history is kept in full. The active prescription cannot be quietly replaced.",
        },
      ],
    },
    onboarding: {
      h2: "You are the one who opens access",
      lead: "There is no self sign-up: a family joins KetoCare by invitation from their treating clinician or dietitian — every patient has a lead specialist from day one.",
      items: [
        {
          title: "An invitation at the visit",
          text: "You hand the family an invitation link during the visit — no mailings, no email chase.",
        },
        {
          title: "The family creates the child's profile",
          text: "A short guided questionnaire, one question per screen. The diagnosis and the exact list of medications are entered by you — that keeps them accurate.",
        },
        {
          title: "The patient appears in your list",
          text: "Diaries and menus are visible right away. A colleague for a second opinion, or a dietitian, is added by the lead specialist.",
        },
      ],
    },
    pilot: {
      h2: "How a pilot runs",
      items: [
        {
          title: "A walkthrough of the workspace",
          text: "We show the clinician and parent workspaces on demo data and answer your questions about the calculations and tolerances.",
        },
        {
          title: "Alignment with your protocols",
          text: "We go through your prescribing and monitoring scenarios; where it helps, they become reference tests for the calculation engine.",
        },
        {
          title: "The first families, together",
          text: "We onboard the first patients under your supervision, gather feedback and refine whatever gets in your way.",
        },
      ],
    },
    ctaForm: {
      h2: "Request a pilot",
      lead: "Leave your work email — we will get in touch, show you the workspace and discuss the shape of a pilot for your clinic or practice.",
      direct: "Or write to us directly:",
    },
  },

  footer: {
    disclaimer:
      "KetoCare is a tool for supporting therapy prescribed by a clinician. It does not replace medical advice: ketogenic diet therapy is started and adjusted only by the treating team.",
    sectionsTitle: "Sections",
    contactsTitle: "Contacts",
    telegram: "Telegram",
    copyright: "© {year} RailTech LLC",
  },
};
