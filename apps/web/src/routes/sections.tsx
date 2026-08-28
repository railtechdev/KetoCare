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
import { SettingsPage } from "../features/settings/SettingsPage";

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
  patients: () => <DoctorPatientsPage />,
  products: (role) =>
    role === "admin" ? <AdminPage section="products" /> : <ProductsPage />,
  users: () => <AdminPage section="users" />,
  dictionaries: () => <AdminPage section="dictionaries" />,
  audit: () => <AdminPage section="audit" />,
  settings: () => <SettingsPage />,
};

/**
 * Разделы без экрана — пп. 14 и далее раздела 15 ТЗ. Список ведётся явно, а не
 * выводится как «всё, чего нет в SECTION_SCREENS»: тогда раздел, добавленный в
 * SECTIONS_BY_ROLE без экрана, попадал бы в заглушку молча. Тест сверяет оба
 * списка с ролевой таблицей, поэтому забыть подключить экран нельзя.
 */
export const PENDING_SECTIONS: readonly string[] = [
  "reports",
  "assistant",
  "summaries",
];
