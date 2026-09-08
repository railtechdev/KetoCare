import {
  Bot,
  Calculator,
  CalendarDays,
  FileText,
  Home,
  Inbox,
  ListTree,
  NotebookPen,
  Salad,
  ScrollText,
  Baby,
  ShoppingBasket,
  UserCog,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { lazy, type ReactElement } from "react";

import type { Role } from "../features/auth/roles";
import { PatientGate } from "../features/patients/PatientGate";
import { canEditCatalog } from "../features/products/types";

/**
 * Экраны загружаются по требованию, а не все сразу.
 *
 * Замер до разделения: `apps/web` собирался в ОДИН файл 1 612 кБ (451 кБ
 * gzip), и родитель на телефоне скачивал его целиком, прежде чем увидеть хоть
 * что-нибудь: вместе со своей главной — админку, карту пациента врача,
 * справочники, журнал аудита. Внутри: recharts с lodash — 705 кБ (нужны только
 * дневнику и отчёту), таблица TanStack — 136 кБ, генератор QR-кода — 71 кБ
 * (нужен один раз в жизни, при настройке второго фактора специалиста).
 *
 * Разделение по разделам, а не по ролям: раздел — это то, что человек
 * открывает, и граница загрузки должна совпадать с границей перехода.
 * Пока чанк едет, `SectionRoute` показывает скелетон — экран не мигает пустотой.
 */
const AdminPage = lazy(() =>
  import("../features/admin/AdminPage").then((m) => ({ default: m.AdminPage })),
);
const AssistantPage = lazy(() =>
  import("../features/assistant/AssistantPage").then((m) => ({
    default: m.AssistantPage,
  })),
);
const CalculatorPage = lazy(() =>
  import("../features/calculator/CalculatorPage").then((m) => ({
    default: m.CalculatorPage,
  })),
);
const DiaryPage = lazy(() =>
  import("../features/diary/DiaryPage").then((m) => ({ default: m.DiaryPage })),
);
const AdminHomePage = lazy(() =>
  import("../features/admin/AdminHomePage").then((m) => ({
    default: m.AdminHomePage,
  })),
);
const DoctorHomePage = lazy(() =>
  import("../features/doctor/DoctorHomePage").then((m) => ({
    default: m.DoctorHomePage,
  })),
);
const DoctorPatientsPage = lazy(() =>
  import("../features/doctor/DoctorPatientsPage").then((m) => ({
    default: m.DoctorPatientsPage,
  })),
);
const HomePage = lazy(() =>
  import("../features/home/HomePage").then((m) => ({ default: m.HomePage })),
);
const MenuPage = lazy(() =>
  import("../features/menu/MenuPage").then((m) => ({ default: m.MenuPage })),
);
const CatalogPage = lazy(() =>
  import("../features/products/CatalogPage").then((m) => ({
    default: m.CatalogPage,
  })),
);
const ProductsPage = lazy(() =>
  import("../features/products/ProductsPage").then((m) => ({
    default: m.ProductsPage,
  })),
);
const RecipesPage = lazy(() =>
  import("../features/recipes/RecipesPage").then((m) => ({
    default: m.RecipesPage,
  })),
);
const ReportsPage = lazy(() =>
  import("../features/reports/ReportsPage").then((m) => ({
    default: m.ReportsPage,
  })),
);
const ProfilePage = lazy(() =>
  import("../features/profile/ProfilePage").then((m) => ({
    default: m.ProfilePage,
  })),
);
const ChildPage = lazy(() =>
  import("../features/child/ChildPage").then((m) => ({ default: m.ChildPage })),
);

/**
 * Экран раздела. Роль — аргумент, потому что один и тот же ключ раздела
 * означает разные экраны: `products` для семьи и диетолога — справочник,
 * для администратора — редактор базы с импортом CSV и историей ревизий.
 *
 * Роль здесь определяет только вид экрана. Право читать и писать проверяет
 * сервер на каждом запросе (правило 5 CLAUDE.md).
 */
export type SectionScreen = (role: Role | undefined) => ReactElement;

export const SECTION_SCREENS: Record<string, SectionScreen> = {
  // Помощник — только у семьи и только с выбранным ребёнком: обращение обязано
  // идти с `patient_id`, иначе переписку не удалит `erase_patient` (ADR-0019),
  // а врач не увидит переписку своего пациента.
  assistant: () => (
    <PatientGate
      render={(patientId) => <AssistantPage patientId={patientId} />}
    />
  ),
  // Главная у семьи и у специалиста отвечает на разные вопросы: родителю —
  // «что сейчас», врачу — «кем заняться» (`docs/DESIGN_PROPOSAL.md`). Экран
  // выбирается по роли, как у `products`; право читать проверяет сервер.
  home: (role) =>
    role === "admin" ? (
      <AdminHomePage />
    ) : role === "doctor" || role === "dietitian" ? (
      <DoctorHomePage />
    ) : (
      <PatientGate render={(patientId) => <HomePage patientId={patientId} />} />
    ),
  calculator: () => (
    <PatientGate
      render={(patientId) => <CalculatorPage patientId={patientId} />}
    />
  ),
  menu: () => (
    <PatientGate render={(patientId) => <MenuPage patientId={patientId} />} />
  ),
  diary: () => (
    <PatientGate render={(patientId) => <DiaryPage patientId={patientId} />} />
  ),
  recipes: () => <RecipesPage />,
  reports: () => (
    <PatientGate
      render={(patientId) => <ReportsPage patientId={patientId} />}
    />
  ),
  patients: () => <DoctorPatientsPage />,
  // Справочник продуктов: семье и врачу на чтение, диетологу — с правкой,
  // администратору — с правкой, импортом и историей. Право проверяет сервер
  // (`_EDITOR_ROLES` в routers/products.py); здесь только UX.
  products: (role) =>
    role === "admin" ? (
      <AdminPage section="products" />
    ) : canEditCatalog(role) ? (
      <CatalogPage />
    ) : (
      <ProductsPage />
    ),
  users: () => <AdminPage section="users" />,
  leads: () => <AdminPage section="leads" />,
  dictionaries: () => <AdminPage section="dictionaries" />,
  audit: () => <AdminPage section="audit" />,
  child: () => <ChildPage />,
  profile: () => <ProfilePage />,
};

/**
 * Разделы, объявленные в ролевой таблице, но пока без экрана.
 *
 * Пуст — и это правильное состояние: пункт меню, за которым ничего нет, хуже
 * его отсутствия (правило П3 канона). «Отчёты», «Ассистент» и «Сводки» убраны
 * из навигации до своих этапов и вернутся вместе с работой.
 *
 * Список оставлен намеренно: он нужен, когда раздел уже объявлен в ролевой
 * таблице, а экран ещё пишется, — иначе роутер уронил бы тест на отсутствии
 * экрана. Пустым он значит «таких разделов сейчас нет».
 */
export const PENDING_SECTIONS: readonly string[] = [];

/**
 * Значок раздела в навигации.
 *
 * Лежит рядом с сопоставлением «раздел → экран», а не в разметке навигации:
 * иначе новый раздел получал бы экран и оставался без значка, и в меню
 * появлялась дырка. Тест требует значок для каждого раздела ролевой таблицы.
 */
export const SECTION_ICONS: Record<string, LucideIcon> = {
  home: Home,
  calculator: Calculator,
  products: ShoppingBasket,
  recipes: Salad,
  menu: CalendarDays,
  diary: NotebookPen,
  reports: FileText,
  assistant: Bot,
  child: Baby,
  patients: Users,
  users: UserCog,
  leads: Inbox,
  dictionaries: ListTree,
  audit: ScrollText,
  profile: UserRound,
};
