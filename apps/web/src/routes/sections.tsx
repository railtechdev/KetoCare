import {
  Bot,
  Calculator,
  CalendarDays,
  ClipboardList,
  FileText,
  Home,
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
import type { ReactElement } from "react";

import { AdminPage } from "../features/admin/AdminPage";
import type { Role } from "../features/auth/roles";
import { CalculatorPage } from "../features/calculator/CalculatorPage";
import { DiaryPage } from "../features/diary/DiaryPage";
import { DoctorPatientsPage } from "../features/doctor/DoctorPatientsPage";
import { HomePage } from "../features/home/HomePage";
import { PatientGate } from "../features/patients/PatientGate";
import { MenuPage } from "../features/menu/MenuPage";
import { ProductsPage } from "../features/products/ProductsPage";
import { RecipesPage } from "../features/recipes/RecipesPage";
import { ReportsPage } from "../features/reports/ReportsPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { ChildPage } from "../features/child/ChildPage";

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
  home: () => (
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
    <PatientGate render={(patientId) => <ReportsPage patientId={patientId} />} />
  ),
  patients: () => <DoctorPatientsPage />,
  products: (role) =>
    role === "admin" ? <AdminPage section="products" /> : <ProductsPage />,
  users: () => <AdminPage section="users" />,
  dictionaries: () => <AdminPage section="dictionaries" />,
  audit: () => <AdminPage section="audit" />,
  child: () => <ChildPage />,
  profile: () => <ProfilePage />,
};

/**
 * Разделы, объявленные в ролевой таблице, но пока без экрана.
 *
 * Список короткий намеренно: пункт меню, за которым ничего нет, хуже его
 * отсутствия (правило П3 канона). «Отчёты» и «Ассистент» убраны из навигации
 * родителя до своих этапов и вернутся вместе с работой; здесь остаётся только
 * то, что роль всё же видит.
 */
export const PENDING_SECTIONS: readonly string[] = ["summaries"];

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
  summaries: ClipboardList,
  users: UserCog,
  dictionaries: ListTree,
  audit: ScrollText,
  profile: UserRound,
};
