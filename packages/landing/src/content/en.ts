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
    toggleTheme: "Toggle theme (light / dark)",
    grams: "g",
    kcal: "kcal",
    fat: "Fat",
    protein: "Protein",
    carbs: "Carbs",
    netCarbs: "Net carbs",
    gki: "GKI index",
    glucose: "Glucose",
    ketones: "Ketones",
    seizure: "Seizure",
    weight: "Weight",
    ratio: "Keto ratio",
    clinicCode: "I have a clinic code",
    login: "Log in",
    admin: "Admin portal",
  },

  nav: {
    howItWorks: "How it works",
    forFamilies: "For families",
    forDoctors: "For clinicians",
    methodology: "Methodology & safety",
    doctors: "For clinicians",
    login: "Log in",
    admin: "Admin",
    clinicCode: "Clinic code",
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
    errorRateLimited:
      "Too many requests from your address. Write to us at {email}.",
    doneFamily: "Got it. We will write to {email} and help you get set up.",
    doneDoctor:
      "Your request is in. We will reply to {email} within the next few days.",
    consent:
      "By sending this form you agree that we may contact you at the address you provide. Please do not include medical data in the form.",
  },

  home: {
    seo: {
      title:
        "KetoCare — pediatric ketogenic diet therapy under clinical supervision",
      description:
        "Ketogenic diet therapy platform for children with drug-resistant epilepsy: meals calculated to prescription, six diaries, clinical triage for doctors. Web and Telegram.",
    },
    hero: {
      badge: "Platform active and evolving",
      h1: "Pediatric ketogenic diet therapy — strictly per clinical prescription",
      lead: "KetoCare brings families and clinicians into a single clinical loop: automated meal calculations with error protection, real-time GKI monitoring, seizure logging (Web + Telegram Mini App), and patient triage for clinicians.",
      ctaFamily: "Early access for families",
      ctaDoctors: "Clinicians & centers",
      ctaClinicCode: "I have a clinic code",
      chips: [
        "Strictly per physician prescription",
        "Mathematical gram calculation",
        "GKI & Atwater checksum verification",
        "Web + Telegram Mini App",
      ],
      card: {
        today: "Today",
        childName: "Anya · 7 yo",
        childInitials: "AI",
        nextMeal: "Next meal · 12:30",
        ratio: "3.50 : 1",
        dish: "Omelet with heavy cream and broccoli",
        dishMacros: "310 kcal · fat 29.4 g · protein 6.8 g · carbs 1.6 g",
        dayVsPrescription: "Day vs Prescription",
        caloriesLabel: "Calories",
        caloriesValue: "742 / 1200 kcal",
        fatValue: "68.2 g",
        proteinValue: "17.1 g",
        carbsValue: "7.7 g",
        carbsLeft: "Carbs remaining today: <strong>4.3 g</strong> of 12",
        quickKetones: "+ Ketones",
        quickWeight: "+ Weight",
        quickSeizure: "Seizure",
        caption: "Parent dashboard — main home screen preview",
      },
      preview: {
        tabParent: "Parent Mode (Diary & Nutrition)",
        tabDoctor: "Doctor Mode (Clinical Triage & GKI)",
        parent: {
          childName: "Anya I. · 7 yo",
          childInitials: "AI",
          today: "Today",
          targetRatioBadge: "3.50 : 1 — Target met",
          nextMeal: "Lunch · 12:30",
          dish: "Omelet with heavy cream and broccoli",
          dishGrams:
            "Egg 40 g · Heavy cream 35 g · Butter 22 g · Broccoli 25 g",
          dishMacros: "310 kcal · fat 29.4 g · protein 6.8 g · carbs 1.6 g",
          dayVsPrescription: "Day vs Prescription",
          caloriesLabel: "Calories",
          caloriesValue: "742 / 1200 kcal",
          fatValue: "68.2 g",
          proteinValue: "17.1 g",
          carbsValue: "7.7 g",
          carbsLeft: "Carbs remaining today: <strong>4.3 g</strong> of 12",
          gkiBadge: "GKI 1.8 — Deep therapeutic ketosis",
          gkiDetails: "Glucose: 4.5 mmol/L · Ketones: 2.5 mmol/L",
          quickKetones: "+ Ketones",
          quickGlucose: "+ Glucose",
          quickWeight: "+ Weight",
          quickSeizure: "Seizure",
          caption:
            "Parent dashboard (PR #303) — exact gram weights, daily targets, and 1-click logs",
        },
        doctor: {
          pinnedHeader: {
            patientName: "Anya I. · 7 yo (21.4 kg, 118 cm)",
            prescription:
              "Prescription: 3.50 : 1 · 1200 kcal/day · protein 25 g",
            gki: "Current GKI: 1.80 (in range)",
          },
          triageTitle: "Clinical Patient Triage (Traffic Light)",
          triageRed: {
            name: "Misha K. · 5 yo",
            badge: "Red zone",
            reason:
              "No data for 4 days · Risk of hypoglycemia and seizure cluster",
          },
          triageYellow: {
            name: "Anya I. · 7 yo",
            badge: "Yellow zone",
            reason: "Ratio 2.90 : 1 (below target corridor 3 days in a row)",
          },
          triageGreen: {
            name: "Damir T. · 9 yo",
            badge: "Green zone",
            reason: "GKI 1.45 · Ketones 3.2 mmol/L · 0 seizures in 14 days",
          },
          trendTitle: "Ketones and glucose trend (therapeutic corridor)",
          trendKetones: "Blood ketones: 1.2 → 2.8 mmol/L (rising)",
          trendGlucose: "Blood glucose: 4.8 → 4.3 mmol/L (stable)",
          trendGki: "GKI decreased from 3.8 to 1.8 (therapeutic target met)",
          caption:
            "Doctor cabinet (PR #303) — clinical patient traffic light, pinned header, and trends",
        },
      },
    },
    stats: [
      {
        value: "3.50 : 1",
        label: "Target prescription corridor",
        note: "Mathematical LP engine control",
      },
      {
        value: "< 10%",
        label: "Atwater checksum verification",
        note: "Protects food database from labeling errors",
      },
      {
        value: "5 sec",
        label: "Logging seizure or ketones",
        note: "Web + Telegram Mini App",
      },
      {
        value: "2FA",
        label: "Clinical secure perimeter",
        note: "Strict RBAC & audit logging",
      },
    ],
    portalNav: {
      eyebrow: "Platform sections",
      h2: "Unified medical platform for families and clinical teams",
      lead: "Engineered with specialized operational environments, strict role segregation, and seamless real-time data sync.",
      familyCard: {
        badge: "For parents",
        title: "For families & patients",
        desc: "Kitchen-ready gram weights, automated substitutions, Telegram Mini App, and 6 diaries without paper notebooks.",
        cta: "Explore family portal",
      },
      doctorCard: {
        badge: "For clinicians",
        title: "For clinicians & centers",
        desc: "Real-time patient traffic light triage, LP gram optimization, and pre-consultation reports.",
        cta: "Clinical features in detail",
      },
      methodologyCard: {
        badge: "Evidence base",
        title: "Methodology & security",
        desc: "Isolated keto_engine math core, Atwater validation, clinical protocols (4:1, MAD), and 2FA protection.",
        cta: "Review methodology",
      },
    },
    mission: {
      eyebrow: "Mission",
      h2: "Delivering clinical precision at home every single day",
      lead: "Ketogenic diet therapy can provide life-changing relief for children with drug-resistant epilepsy — but only when followed with strict adherence. Between consultations, families are left alone with calculations. KetoCare unites family and physician in one secure loop.",
      families: {
        title: "What families can expect",
        items: [
          "Every meal calculated to prescription — no kitchen arithmetic or notebooks",
          "Daily menus and six diaries — in a couple of taps from your phone",
          "Your physician sees real-time trends — you never navigate therapy alone",
        ],
      },
      doctors: {
        title: "What clinicians can expect",
        items: [
          "Versioned prescriptions with tolerances — full immutable audit trail",
          "Risk-sorted patient triage list and detailed interactive chart",
          "Consultation summary generated from family logs — discussions backed by data",
        ],
      },
    },
    steps: {
      eyebrow: "How it works",
      h2: "Three roles, one diary, zero guesswork in the kitchen",
      items: [
        {
          title: "Clinician issues prescription",
          text: "Ketogenic ratio, daily energy target, protein minimum, and carb ceiling — all in one place with an effective start date.",
        },
        {
          title: "Family executes therapy",
          text: "The platform calculates meals and daily plans, immediately confirming compliance. Diaries take seconds via Web or Telegram.",
        },
        {
          title: "Clinician monitors progress",
          text: "Ketones, weight, seizures, and food logs on a single timeline. At each checkup, a comprehensive clinical report replaces hand-written notebooks.",
        },
      ],
      link: "Detailed breakdown of each step",
    },
    forDoctors: {
      eyebrow: "For clinicians & centers",
      h2: "Clinical control of ketotherapy without blind spots",
      lead: "Engineered for pediatric epileptologists and keto-dietitians: from initial titration to data-driven routine consultations.",
      items: [
        {
          title: "Instant clinical triage upon login",
          text: "Clinicians immediately spot patients in red and yellow triage zones: ketone drop, missing logs, or seizure clusters.",
        },
        {
          title: "Mathematical gram optimization (LP engine)",
          text: "Linear programming in keto_engine computes gram weights with mathematical precision, strictly preserving the prescribed ratio and calories.",
        },
        {
          title: "GKI monitoring & Atwater database integrity",
          text: "Automated Glucose-Ketone Index calculation and Atwater macro checksums eliminate manufacturer labeling errors from the product catalog.",
        },
        {
          title: "Secure perimeter: 2FA & one-time clinic codes",
          text: "Mandatory 2FA for clinicians, strict role segregation, and family onboarding via single-use clinic codes without public self-registration.",
        },
      ],
      cta: "Learn more for clinics",
    },
    forFamilies: {
      eyebrow: "For families & patients",
      h2: "Family journey: kitchen confidence and daily peace of mind",
      lead: "Pediatric ketogenic therapy demands extreme precision. KetoCare handles calculations and tracking so you can focus on care.",
      steps: [
        {
          num: "1",
          title: "Receive single-use clinic code",
          text: "During in-person consultation, your doctor sets therapy targets and gives you an instant single-use activation code.",
        },
        {
          num: "2",
          title: "Ready meal plan & kitchen swap calculator",
          text: "Exact gram weights for each meal. If an ingredient is missing, the algorithm calculates an equivalent swap with preserved ratio.",
        },
        {
          num: "3",
          title: "Log ketones, glucose, and seizures in 5 seconds",
          text: "Input readings via Web or Telegram Mini App. Record seizures with 1 tap ('now'), adding triggers and details later when calm.",
        },
        {
          num: "4",
          title: "Continuous link with your physician",
          text: "Your doctor monitors patient metrics in real time, and the system prepares an objective consultation report for your next visit.",
        },
      ],
    },
    methodology: {
      eyebrow: "Methodology & safety",
      h2: "Clinical rigor, mathematical verification, and data privacy",
      lead: "Treating drug-resistant epilepsy allows zero margin for calculation errors. Evidence-based clinical guidelines guide our system.",
      items: [
        {
          title: "Isolated mathematical calculation engine",
          text: "Calculations run inside the keto_engine core (linear programming simplex solver). Formulas are deterministic without intermediate rounding.",
        },
        {
          title: "Formula drift protection",
          text: "Strict net carbohydrate accounting (total carbs minus fiber per ingredient clamped at zero) prevents clinical discrepancies.",
        },
        {
          title: "Medical privacy & 2FA protection",
          text: "Clinician two-factor authentication, encrypted backups, and role-based access: parents only view their child, unauthorized access is excluded.",
        },
        {
          title: "Responsible AI with zero hallucination",
          text: "The AI assistant helps parse unstructured text logs and drafts consultation summaries, but never makes clinical decisions or unvetted advice.",
        },
      ],
    },
    calc: {
      eyebrow: "Try it yourself",
      h2: "Assemble breakfast for a 3.5 : 1 prescription",
      lead1:
        "The ketogenic ratio is fat divided by protein plus net carbs (fiber is excluded from the denominator). Every meal must hit the prescribed ratio within tolerance.",
      lead2:
        "Move the sliders for instant feedback. In real life, KetoCare does this automatically: no kitchen scale calculations or notebook math required.",
      note: "Nutrient data from USDA FoodData Central. In production, calculations run through an isolated engine validated against medical benchmark suites.",
      dish: "Omelet with heavy cream and broccoli",
      ingredients: ["Chicken egg", "Heavy cream 33%", "Butter", "Broccoli"],
      netCarbs: "Of which net carbs",
      netCarbsNote: "ratio is computed using this figure",
      atwaterTitle: "Atwater Checksum Verification",
      atwaterBadge: "✓ Atwater verification: error < 2% (clinical limit < 10%)",
      atwaterNote:
        "KetoCare automatically validates each dish and product: calculated energy (9×F + 4×P + 4×Cnet) is cross-checked against labels to prevent nutrition errors.",
      targetRatioCorridor:
        "Target prescription corridor: 3.50 : 1 (tolerance ±0.15)",
      disclaimer:
        "This is an educational formula demo, not a dietary planning tool. Your child's diet must be planned in the app based on an active clinical prescription.",
      sliderLabel: "{name}, grams",
      verdictOk: "Matches 3.5 : 1 prescription (preliminary tolerance ±0.15)",
      verdictLow: "Below prescription — add fat or decrease carbohydrates",
      verdictHigh: "Above prescription — fat exceeds prescribed ratio",
    },
    diaries: {
      eyebrow: "Diaries",
      h2: "Six clinical diaries — in a couple of taps",
      lead: "Seizures, ketones, weight, nutrition, medication, and overall wellbeing. Everything logged by the family — via Web, bot, or Mini App — syncs to one diary.",
      ketones: {
        title: "Ketones over 14 days",
        badge: "3.5 mmol/L",
        caption:
          "Reaching therapeutic ketosis is visible on charts, not guessed by feeling",
        chartAlt:
          "Chart of ketone readings over 14 days: steady rise from 1.2 to 3.5 mmol/L.",
      },
      seizure: {
        title: "Log seizures instantly, add details later",
        text: "Nobody fills out forms during a seizure. Log it in one or two taps: type and 'now'. Add triggers and notes later once the child is safe. For clinicians, logs automatically format into monthly grids.",
        chipType: "Tonic-clonic",
        chipNow: "Now",
      },
      progress: {
        title: "Progress means 'remaining', not just 'eaten'",
        text: "'4.3 g carbs remaining today' is a clear answer, not a math puzzle. Warnings trigger only upon genuine divergence from clinical goals.",
      },
    },
    telegram: {
      eyebrow: "Telegram",
      h2: "Log directly from your messenger",
      lead: "Ketone check — one quick message to the bot. The bot and Telegram Mini App are core parts of the platform: everything feeds into the patient record.",
      items: [
        "Ketones, weight, wellbeing, and seizures — logged in 2–4 button taps",
        "Freeform text meals — AI parses macros, you verify",
        "Reminders for tests and medication — sent to all caregivers",
        "Telegram Mini App: daily meal plan, calculator, recipes, diary, and 'Family'",
      ],
      botLabel: "bot",
      replay: "Replay",
      caption:
        "Scenario demo. The bot does not provide medical advice — only rapid logging and reminders",
      chat: [
        { from: "user", text: "ketones 2.6", time: "08:11" },
        {
          from: "bot",
          text: "Ketones 2.6 mmol/L. Which measurement method did you use?",
          time: "08:11",
          chips: ["Blood", "Urine"],
        },
        { from: "user", text: "Blood", time: "08:12" },
        {
          from: "bot",
          text: "Recorded ✓ Ketones 2.6 mmol/L (blood), today at 08:12. Saved to diary for your physician.",
          time: "08:12",
        },
        { from: "user", text: "weight 21.4", time: "14:05" },
        {
          from: "bot",
          text: "Weight 21.4 kg. Save for today?",
          time: "14:05",
          chips: ["Yes, for today", "Other date"],
        },
        { from: "user", text: "Yes, for today", time: "14:05" },
        {
          from: "bot",
          text: "Recorded ✓ Weight 21.4 kg, today. Trend updated in patient chart.",
          time: "14:06",
        },
      ] as ChatMsg[],
    },
    doctorsTeaser: {
      eyebrow: "For clinicians & dietitians",
      h2: "Not 'how many patients', but who needs attention today",
      lead: "Patient lists sorted by clinical risk: caregiver silence, diet out of bounds, or week-over-week seizure clusters.",
      cta: "Explore clinician portal",
      queueTitle: "Attention queue",
      queue: [
        {
          name: "Misha K.",
          status: "no data",
          reason: "No diary entries logged for 4 days",
          age: "4 days ago",
          level: "danger",
        },
        {
          name: "Anya I.",
          status: "nutrition",
          reason: "Ratio out of target for 3 consecutive days",
          age: "logged today",
          level: "warning",
        },
        {
          name: "Vera S.",
          status: "seizures",
          reason: "Seizure frequency higher than previous week",
          age: "logged yesterday",
          level: "warning",
        },
      ] as QueueItem[],
      queueNote:
        "Status is always indicated with words — color is never the only signal",
    },
    trust: {
      eyebrow: "Why you can trust KetoCare",
      h2: "Calculation error is a clinical risk. We design around that.",
      items: [
        {
          title: "Verified against reference benchmarks",
          text: "The calculation core is isolated and regression-tested against reference scenarios on every release.",
        },
        {
          title: "Role-based access",
          text: "Parents only see their child; clinicians only see their patients. Two-factor authentication and full audit logging.",
        },
        {
          title: "AI does not make medical decisions",
          text: "AI parses natural language and drafts summaries, but every entry requires human confirmation and no PII leaves the platform.",
        },
        {
          title: "Choice of access channels",
          text: "Web portal, Telegram bot, and Telegram Mini App write to the same single diary. Families use whatever is easiest today.",
        },
      ],
    },
    faq: {
      h2: "Frequently Asked Questions",
      items: [
        {
          q: "How can our family get access to KetoCare?",
          a: "Access is granted by your attending pediatric epileptologist or keto-dietitian during a consultation: the specialist sets your clinical targets and gives you a single-use clinic code. If your doctor is not yet on KetoCare, submit an early access request and we will connect with your clinic.",
        },
        {
          q: "Can we use KetoCare on mobile via Telegram?",
          a: "Yes. All diary and menu features are accessible from your smartphone via the Telegram bot and our full-featured Telegram Mini App. You can log seizures in 1 tap, record ketone and glucose levels, and check meal gram weights on the go.",
        },
        {
          q: "Does the system support classical keto (4:1, 3:1) and Modified Atkins Diet (MAD)?",
          a: "Yes, KetoCare supports all evidence-based ketogenic therapy protocols: classical keto diets (4:1, 3.5:1, 3:1), Medium-Chain Triglyceride (MCT) diets, Modified Atkins Diet (MAD) with 10–20 g/day carbohydrate limits, and Low Glycemic Index Treatment (LGIT).",
        },
        {
          q: "How is my child's medical data protected?",
          a: "Data is segregated and protected according to clinical security standards: strict role-based access (caregivers only view their child, doctors only view their patients), 2FA authentication, complete audit logging, and encrypted backups.",
        },
        {
          q: "Does this platform replace our doctor or dietitian?",
          a: "Absolutely not. Ketogenic diet therapy is a serious clinical medical treatment and must be conducted strictly under the care of an epileptologist and dietitian. KetoCare ensures exact execution and eliminates kitchen math errors.",
        },
        {
          q: "Can multiple caregivers log entries for the same child?",
          a: "Yes. Multiple adult accounts (both parents, grandparents, babysitters) can be linked to the same child profile. All entries synchronize immediately, providing the clinician with a unified, accurate record.",
        },
      ],
    },
    cta: {
      h2: "Let's connect",
      lead: "The platform is fully functional and continuously advancing. Family access is issued by attending doctors; we onboard clinics and practices directly.",
      family: {
        eyebrow: "For families",
        title: "Access for your family",
        text: "Access is provided by your attending physician via invitation. If your doctor is not yet using KetoCare, leave your email and we will help introduce them.",
      },
      doctors: {
        eyebrow: "For clinicians & centers",
        title: "Request a pilot",
        text: "We will demonstrate the clinician portal, review your center's protocols, and onboard your first patients alongside you.",
        cta: "Details and application",
      },
    },
  },

  howItWorks: {
    seo: {
      title:
        "How KetoCare works — from clinical prescription to consult report",
      description:
        "Five steps of ketogenic diet therapy in KetoCare: physician sets targets, family builds meals and logs diaries, clinician tracks trends. Web, Telegram bot, and Mini App.",
    },
    hero: {
      eyebrow: "How it works",
      h1: "From prescription to report — one continuous loop",
      lead: "Clinicians, families, and data operate within one unified system. Nothing is re-copied from paper notebooks, recalculated on kitchen scales, or lost between visits.",
    },
    steps: [
      {
        role: "Clinician",
        title: "Invites family and sets prescription targets",
        paragraphs: [
          "Access is opened by the attending physician during the consultation via an invitation code. The parent sets up the child's profile and answers a short questionnaire. The diagnosis and exact medication list are entered by the doctor.",
          "Next is the prescription: ketogenic ratio, daily calories, protein goal, and carbohydrate limit, with an effective start date. Every modification creates a new version with full historical tracking.",
        ],
        chips: ["3.5 : 1", "1200 kcal/day", "protein 25 g", "carbs ≤ 12 g"],
      },
      {
        role: "Family",
        title: "Assembles meals without kitchen arithmetic",
        paragraphs: [
          "The parent selects ingredients and gram amounts — the platform calculates macros and ratio instantly, confirming if the meal meets the prescription. Ingredient entry starts with 'Recent' and 'Frequent' items rather than empty searches.",
        ],
        verdictBadge: "3.52 : 1",
        verdictText: "Prescription met · preliminary tolerance ±0.15",
        chips: [],
      },
      {
        role: "Family",
        title: "Logs diaries in a few taps",
        paragraphs: [
          "Seizures, ketones, weight, meals, medications, and overall status — via Web or Telegram bot messages. Meals can be entered as natural text: AI parses ingredients, you verify. Seizures are recorded in 1–2 taps ('now'), with details added later.",
        ],
        chips: ["+ Ketones", "+ Weight", "+ Medication", "Seizure — now"],
      },
      {
        role: "Clinician",
        title: "Tracks trends between consultations",
        paragraphs: [
          "Ketones, weight, seizures, and nutrition on a single timeline with prescription change markers. Patients requiring attention rise to the top automatically: caregiver silence, diet drift, or seizure increases.",
        ],
        chips: [],
      },
      {
        role: "Together",
        title: "Consultations driven by data, not memory",
        paragraphs: [
          "By the next visit, an objective summary is ready: biomarker trends, seizure frequency, and dietary adherence. The conversation begins with facts, and dosage or ratio adjustments are made with confidence.",
        ],
        chips: [],
      },
    ] as HowStep[],
    channels: {
      h2: "One clinical diary, four channels",
      lead: "Wherever the family enters data — everything syncs into one place and is visible to the clinician.",
      items: [
        {
          title: "Web portal",
          text: "Parent, physician, dietitian, and admin dashboards. Meal planning, diaries, patient charts, and reports.",
        },
        {
          title: "Telegram bot",
          text: "Rapid entry of diary records via short messages and automated reminders for tests.",
        },
        {
          title: "Mini App",
          text: "Full parent mobile dashboard inside Telegram — no app store installation required.",
        },
        {
          title: "AI assistant",
          text: "Parses natural language meal notes and drafts consult summaries. Every entry requires human verification.",
        },
      ],
    },
    status: {
      eyebrow: "Platform status",
      h2: "Core capabilities are fully active",
      nowTitle: "Active today",
      now: [
        "Parent, clinician, and administrator portals",
        "Deterministic calculation core with benchmark test suites",
        "Prescriptions, product database, meal planner, and six diaries",
        "2FA login, role-based access, full audit logging",
      ],
      nextTitle: "In active development",
      next: [
        "Telegram bot automated reminders",
        "Telegram Mini App expanded modules",
        "Family AI logging assistant & summary drafts",
      ],
      note: "Public self-registration is intentionally absent: families are invited by clinicians, clinics are onboarded directly.",
    },
    cta: {
      h2: "Explore for your practice",
      lead: "Families — early access waiting list. Clinicians and centers — pilot program with live portal demo.",
    },
  },

  doctors: {
    seo: {
      title:
        "KetoCare for clinicians & dietitians — ketogenic diet therapy oversight",
      description:
        "KetoCare clinician portal: risk-sorted patient triage, patient charts with ketones, weight, and seizure trends, consult reports, and versioned prescriptions.",
    },
    hero: {
      eyebrow: "For clinicians & dietitians",
      h1: "Prescriptions executed. You see exactly how.",
      lead: "Between appointments, families are left alone: weighing, calculating, and logging in notebooks. KetoCare brings therapy execution into a supervised clinical loop — you review real trends and deviations instead of recollections months later.",
      ctaPilot: "Request a pilot",
      ctaHow: "How the clinical loop works",
      card: {
        title: "Prescription · Anya I.",
        badge: "active since 16.08",
        ratioLabel: "Ratio",
        ratioValue: "3.5 : 1",
        caloriesLabel: "Energy",
        caloriesValue: "1200 kcal",
        proteinLabel: "Protein",
        proteinValue: "25 g/day",
        carbsLabel: "Carbs",
        carbsValue: "≤ 12 g/day",
        mealsLabel: "Meals per day",
        mealsValue: "4",
        note: "Caregivers view these exact targets in their dashboard; every meal and day is verified automatically against preliminary ±0.15 ratio tolerance.",
      },
    },
    benefits: {
      h2: "A productive clinical workday, not a vanity dashboard",
      queue: {
        title: "Attention queue",
        text: "Patients sorted by clinical risk rather than alphabetical order: caregiver silence, diet drift, week-over-week seizure clusters.",
        rows: [
          {
            name: "Misha K.",
            reason: "no diary entries logged for 4 days",
            level: "danger",
          },
          {
            name: "Anya I.",
            reason: "day exceeds tolerance 3 days in a row",
            level: "warning",
          },
        ] as { name: string; reason: string; level: Level }[],
      },
      chart: {
        title: "Patient chart",
        text: "Ketones, weight, seizures, nutrition, and medications on a single timeline with prescription modification markers: evaluate therapy changes clearly.",
        legend: "prescription adjusted 3.0 → 3.5",
        chartAlt:
          "Metric chart over time: steady rise, steepening noticeably after the prescription adjustment marker.",
      },
      report: {
        title: "Consultation report",
        text: "Summary for the inter-visit period compiled directly from family logs: trends, seizures, target adherence. Export to PDF and CSV.",
        sampleTitle: "Summary · 16.08 — 30.08",
        sampleLines: [
          "Ketones: median 2.8 mmol/L · Weight: −0.3 kg",
          "Seizures: 4 (down from 7 in previous period)",
          "Days within ratio tolerance: 11 of 14",
        ],
      },
      grid: {
        title: "Seizures in familiar clinical grid",
        text: "Families record individual events with time and duration. For the doctor, entries aggregate into a monthly type-by-time-of-day grid, matching paper logs.",
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
        caption: "Seizure grid: seizure type by rows, time of day by columns.",
      },
    },
    rigor: {
      eyebrow: "Clinical rigor",
      h2: "Calculation is no place for improvisation",
      items: [
        {
          title: "Isolated calculation engine",
          text: "Nutrition and ratio calculations run in a dedicated module, isolated from frontend and presentation logic.",
        },
        {
          title: "Reference benchmark suites",
          text: "The core is validated against gold-standard clinical scenarios with full test coverage; discrepancies block release.",
        },
        {
          title: "Roles, 2FA, audit logs",
          text: "Strict role-based access: clinicians see their patients, parents see their child. Two-factor authentication, full audit log of data events.",
        },
        {
          title: "Traceable product database",
          text: "Every food product includes data source and version (e.g. USDA FoodData Central) and verification timestamp. Zero unverified crowd-sourced numbers.",
        },
        {
          title: "Immutable prescriptions",
          text: "Every adjustment creates a new version with author and effective date; full historical audit trail preserved.",
        },
      ],
    },
    onboarding: {
      h2: "You provide access to the family",
      lead: "No public self-registration: families join KetoCare via physician invitation — each patient has an assigned specialist from day one.",
      items: [
        {
          title: "In-consultation invitation",
          text: "Provide the family with an invitation link directly during their visit — no email spam or complex signups.",
        },
        {
          title: "Family creates child profile",
          text: "Short step-by-step onboarding wizard. Diagnosis and exact medication regimens are entered by the clinician.",
        },
        {
          title: "Patient appears in your panel",
          text: "Diaries and meal plans appear immediately. Secondary opinions and dietitians can be linked by the primary specialist.",
        },
      ],
    },
    pilot: {
      h2: "How the pilot runs",
      items: [
        {
          title: "Portal demonstration",
          text: "We demonstrate doctor and caregiver dashboards on clinical demo datasets, answering calculation and tolerance questions.",
        },
        {
          title: "Protocol alignment",
          text: "We analyze your center's titration and monitoring protocols; if needed, they become custom test benchmarks.",
        },
        {
          title: "First cohort onboarding",
          text: "Onboard your initial patient cohort together under your supervision, collecting feedback and tuning workflow ergonomics.",
        },
      ],
    },
    ctaForm: {
      h2: "Request a pilot",
      lead: "Leave your institutional email — we will connect, demonstrate the portal, and arrange a pilot for your clinic.",
      direct: "Or email us directly:",
    },
  },

  forFamiliesPage: {
    seo: {
      title:
        "For Families & Caregivers — KetoCare: pediatric keto without guesswork",
      description:
        "How KetoCare empowers families: clinic code activation, exact gram-calculated recipes, kitchen substitutions, 5-second seizure logging via Telegram Mini App.",
    },
    hero: {
      eyebrow: "For families & patients",
      h1: "Confidence in the kitchen and peace of mind every day",
      lead: "Pediatric ketogenic diet therapy requires extreme precision. KetoCare handles calculations, tracking, and clinical tolerances so you can focus on caring for your child.",
      ctaCode: "I have a clinic code",
      ctaApp: "Open Web Cabinet",
    },
    stepsTitle: "The family journey in 4 clear steps",
    steps: [
      {
        num: "01",
        title: "Receive your activation code from your doctor",
        text: "During consultation, your doctor sets your target ratio and caloric limits, providing a single-use clinic activation code. Zero complicated registration.",
      },
      {
        num: "02",
        title: "Prescription-tailored menu and substitutions",
        text: "Exact gram weights for each meal calculated using net carbs. If an ingredient is missing, the algorithm calculates an equivalent swap in seconds.",
      },
      {
        num: "03",
        title: "Log ketones, glucose, and seizures in 5 seconds",
        text: "Record measurements via Web or Telegram Mini App. A seizure is marked with a single tap ('Now'), and clinical details can be added later.",
      },
      {
        num: "04",
        title: "Continuous sync with your clinical team",
        text: "All entries sync directly to your child's patient file. At your next consultation, your doctor reviews objective trends instead of memory recall.",
      },
    ],
    featuresTitle: "Tools designed for everyday family life",
    features: [
      {
        title: "Telegram Bot & Mini App",
        text: "Full diary capability right on your phone. No need to bring a laptop to the kitchen — submit logs and check recipes in seconds.",
      },
      {
        title: "Six synchronized diaries",
        text: "Blood ketones, glucose, seizures, weight, medications, and nutrition history organized in a single unified timeline.",
      },
      {
        title: "Shared family access",
        text: "Connect parents, grandparents, and caregivers to one child profile: logs stay updated and synchronized across all devices.",
      },
    ],
  },

  methodologyPage: {
    seo: {
      title: "Methodology & Evidence-Based Architecture — KetoCare",
      description:
        "Scientific standards behind KetoCare: isolated keto_engine math core, Atwater checksum verification, 4:1/MAD/LGIT protocols, and clinical 2FA security.",
    },
    hero: {
      eyebrow: "Methodology & Standards",
      h1: "Clinical rigor, mathematical precision, and data security",
      lead: "Dietary therapy for drug-resistant epilepsy cannot tolerate mathematical rounding errors. KetoCare is built on evidence-based protocols and strict healthcare privacy standards.",
    },
    pillarsTitle: "Core architectural pillars",
    pillars: [
      {
        num: "01",
        title: "Isolated mathematical engine (keto_engine)",
        text: "All meal calculations and recipe optimization are handled by an isolated linear programming solver (simplex algorithm). Formulas are locked and free of intermediate rounding errors.",
      },
      {
        num: "02",
        title: "Formula drift protection & net carbohydrates",
        text: "Strict net carbohydrate accounting (carbohydrates minus dietary fiber per ingredient, non-negative, ADR-0030) prevents dangerous ratio drift.",
      },
      {
        num: "03",
        title: "Atwater Checksum & catalog integrity",
        text: "Automated energy verification using the Atwater specific factor system (9×Fat + 4×Protein + 4×NetCarbs) catches supplier labeling discrepancies before they affect ketosis.",
      },
      {
        num: "04",
        title: "Healthcare confidentiality & 2FA security perimeter",
        text: "Mandatory 2FA for clinicians, strict role-based access control (parents only access their child), immutable audit logging, and encrypted backups.",
      },
    ],
    protocolsTitle: "Supported clinical diet protocols",
    protocols: [
      {
        name: "Classic Ketogenic Diet (4:1 and 3:1)",
        desc: "Gold standard for pediatric refractory epilepsy. Very high fat, strictly measured protein, and minimal carbohydrates.",
      },
      {
        name: "Modified Atkins Diet (MAD)",
        desc: "Carbohydrate restriction to 10–20 g/day without strict calorie or protein weighing, ideal for adolescents and outpatient titration.",
      },
      {
        name: "Medium-Chain Triglyceride Diet (MCT)",
        desc: "Incorporates MCT oils, allowing higher protein and carbohydrate allowances while sustaining robust ketogenesis.",
      },
      {
        name: "Low Glycemic Index Treatment (LGIT)",
        desc: "Focuses on carbohydrates with glycemic index under 50 for steady glycemic and anticonvulsant stability.",
      },
    ],
  },

  footer: {
    disclaimer:
      "KetoCare is a clinical companion system for dietotherapy conducted strictly under the supervision of an attending epileptologist or dietitian. It is not a tool for self-treatment and does not replace medical advice: adjustments to the ketogenic regimen and medications are performed exclusively by the medical team.",
    sectionsTitle: "Sections",
    contactsTitle: "Contact",
    adminTitle: "Staff & Admin",
    adminLink: "Admin Dashboard (/admin)",
    telegram: "Telegram",
    copyright: "© {year} LLC 'RailTech'",
  },
};
