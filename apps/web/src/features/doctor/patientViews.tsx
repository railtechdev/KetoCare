import {
  CalendarDays,
  Calculator,
  ClipboardList,
  FileText,
  Gauge,
  NotebookPen,
  StickyNote,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { lazy, type ReactElement } from "react";

import type { PageLayoutProps } from "../../components/PageLayout";
import type { Role } from "../auth/roles";
import { isDoctor, type Patient } from "./types";

/**
 * Разделы карты пациента — реестр «раздел → экран, значок, доступность».
 *
 * Раньше это были шесть вкладок внутри одной страницы, и предел был виден
 * прямо в коде: «шесть — потолок канона» (правило П29). Потолок упирался не в
 * канон, а в полосу: седьмой вкладке негде встать. Разделы стоят столбцом, и
 * их число ограничено тем же, чем в любом меню, — тем, сколько человек готов
 * прочитать глазами.
 *
 * Реестр лежит рядом с экранами, а не в разметке навигации, по той же причине,
 * что и `routes/sections.tsx`: иначе новый раздел получал бы экран и оставался
 * без значка или без пункта меню, и заметить это было бы нечем. Тест требует
 * экран и значок каждому разделу этого списка.
 *
 * Компоненты разделов — те же, что были вкладками карты: вкладка и раздел это
 * одна и та же единица работы, и переписывать их ради нового места в навигации
 * незачем.
 */
const SummaryView = lazy(() =>
  import("./SummaryTab").then((m) => ({ default: m.SummaryTab })),
);
const PrescriptionView = lazy(() =>
  import("./PrescriptionView").then((m) => ({ default: m.PrescriptionView })),
);
const MenuView = lazy(() =>
  import("./PatientMenuTab").then((m) => ({ default: m.PatientMenuTab })),
);
const DiaryView = lazy(() =>
  import("./PatientDiaryTab").then((m) => ({ default: m.PatientDiaryTab })),
);
const ReportsView = lazy(() =>
  import("../reports/ReportsView").then((m) => ({ default: m.ReportsView })),
);
const NotesView = lazy(() =>
  import("./NotesTab").then((m) => ({ default: m.NotesTab })),
);
const CalculatorView = lazy(() =>
  import("../calculator/CalculatorPage").then((m) => ({
    default: m.CalculatorPage,
  })),
);
const ProfileView = lazy(() =>
  import("./PatientProfileView").then((m) => ({
    default: m.PatientProfileView,
  })),
);

/**
 * Порядок — это порядок работы врача, а не алфавит: сводка отвечает «что
 * сейчас», назначение — единственное, что врач здесь МЕНЯЕТ, дальше идёт то,
 * чем он проверяет назначение (питание, калькулятор, дневники, отчёт), и
 * последним — паспорт с анамнезом, за которым приходят реже всего.
 *
 * Калькулятор стоит сразу за питанием, потому что отвечает на его вопрос:
 * «выполнимо ли назначение из того, что ребёнку можно». В общем меню он тоже
 * есть, но там у него нет ни кетосоотношения ребёнка, ни его исключений.
 */
export const PATIENT_VIEWS = [
  "summary",
  "prescription",
  "menu",
  "calculator",
  "diary",
  "reports",
  "notes",
  "profile",
] as const;

export type PatientView = (typeof PATIENT_VIEWS)[number];

export const DEFAULT_PATIENT_VIEW: PatientView = "summary";

export function isPatientView(value: string): value is PatientView {
  return (PATIENT_VIEWS as readonly string[]).includes(value);
}

/**
 * Разделы, доступные роли.
 *
 * Заметки сервер отдаёт только врачу (`clinical.py`), и диетологу этот пункт не
 * показывается: меню, ведущее в заведомый 403, — это тупик, а не ограничение
 * прав. Права при этом проверяет сервер (правило 5 CLAUDE.md).
 */
export function patientViewsFor(
  role: Role | undefined,
): readonly PatientView[] {
  return isDoctor(role)
    ? PATIENT_VIEWS
    : PATIENT_VIEWS.filter((view) => view !== "notes");
}

/**
 * Экран раздела. Роль — аргумент по той же причине, что и у разделов кабинета:
 * профиль показывает медицинскую часть анамнеза только врачу.
 */
export type PatientViewScreen = (
  patient: Patient,
  role: Role | undefined,
) => ReactElement;

export const PATIENT_VIEW_SCREENS: Record<PatientView, PatientViewScreen> = {
  summary: (patient) => <SummaryView patient={patient} />,
  prescription: (patient) => <PrescriptionView patientId={patient.id} />,
  menu: (patient) => <MenuView patientId={patient.id} />,
  calculator: (patient) => <CalculatorView patientId={patient.id} />,
  diary: (patient) => <DiaryView patientId={patient.id} />,
  reports: (patient) => <ReportsView patientId={patient.id} />,
  notes: (patient) => <NotesView patientId={patient.id} />,
  profile: (patient, role) => (
    <ProfileView patient={patient} clinicalAllowed={isDoctor(role)} />
  ),
};

/**
 * Ширина раздела — его роль, а не одно число на всю карту (правило П34).
 *
 * Разделы карты — это разные страницы, и это видно на широком мониторе:
 * дневники, питание и отчёт сравнивают ряды и требуют места; сводка, профиль и
 * заметки читаются, и растянутая на 96rem пара «подпись — значение» оставляет
 * между ними полметра пустоты. Раньше вся карта была одной страницей и роль у
 * неё была одна.
 */
export const PATIENT_VIEW_WIDTH: Record<
  PatientView,
  NonNullable<PageLayoutProps["width"]>
> = {
  summary: "content",
  prescription: "wide",
  menu: "wide",
  // Калькулятор — одна колонка состава и результата под ней: считают по нему
  // построчно, а не сравнивают ряды.
  calculator: "content",
  diary: "wide",
  reports: "wide",
  notes: "content",
  profile: "content",
};

/**
 * Значки повторяют значки разделов семьи (`routes/sections.tsx`): «Дневники» у
 * врача и у родителя — один и тот же раздел, и разные значки у него означали бы,
 * что по телефону они говорят о разном.
 */
export const PATIENT_VIEW_ICONS: Record<PatientView, LucideIcon> = {
  summary: Gauge,
  prescription: ClipboardList,
  menu: CalendarDays,
  calculator: Calculator,
  diary: NotebookPen,
  reports: FileText,
  notes: StickyNote,
  profile: UserRound,
};

/**
 * Раздел по прежнему параметру `?tab=`.
 *
 * Нужен ради ссылок, которые уже разосланы: карта пациента жила по адресу
 * `/app/patients?patient=<id>&tab=<вкладка>`, и такая ссылка есть в переписке
 * врачей и в закладках. Роутер переводит её на новый адрес сам
 * (`router.tsx`), а перевод названий — здесь, рядом со списком разделов.
 *
 * `medications` — вкладка, которой не стало раньше этой работы: лекарства
 * переехали к назначению.
 */
export function patientViewFromTab(tab: string | undefined): PatientView {
  if (tab === undefined) return DEFAULT_PATIENT_VIEW;
  if (tab === "medications") return "prescription";
  return isPatientView(tab) ? tab : DEFAULT_PATIENT_VIEW;
}
