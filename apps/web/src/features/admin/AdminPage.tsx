import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { CatalogPage } from "../products/CatalogPage";
import { AuditPanel } from "./AuditPanel";
import { DictionariesPanel } from "./DictionariesPanel";
import { LeadsPanel } from "./LeadsPanel";
import { UsersPanel } from "./UsersPanel";
import { isAdminSection, type AdminSection } from "./types";

/**
 * Администрирование (раздел 8.1 ТЗ: users, products, dictionaries, audit).
 *
 * Один компонент на пять подразделов, у каждого свой адрес (`/app/users`,
 * `/app/leads`, `/app/products`, `/app/dictionaries`, `/app/audit`).
 * Неизвестное значение открывает учётные записи: пустой экран администратору
 * не помогает.
 *
 * **Полосы вкладок здесь нет, и это правка по аудиту.** Те же пять пунктов
 * стояли и в боковом меню, и вкладками на каждом экране: одна и та же
 * навигация, показанная дважды, занимала верх экрана и заставляла выбирать,
 * каким из двух способов ходить. Раздел называет себя заголовком, а переходы
 * между разделами — дело меню (правило П3 канона).
 *
 * Заголовок берётся у подраздела: «Учётные записи», «Журнал действий» — а не
 * общее «Администрирование» с уточнением ниже. Экран отвечает на вопрос «где
 * я» первой строкой.
 *
 * **Продукты — тот же экран, что у диетолога и врача** (ADR-0072). Раздела нет
 * в меню администратора (ADR-0064), но на него ведут ссылки главной:
 * несверенные продукты, весь справочник. Прежде у администратора был свой
 * экран с видом в состоянии вкладки — F5 возвращал к перечню, — и только на
 * нём стояла проверка подозрительных значений.
 *
 * Клинических данных здесь нет: администратор к ним доступа не имеет
 * (раздел 5.1 ТЗ), и сервер вырезает нагрузку клинических записей даже из
 * журнала аудита.
 */
export function AdminPage({ section }: { section?: string }) {
  const { t } = useTranslation("admin");

  const current = sectionFromRoute(section);
  if (current === "products") return <CatalogPage />;

  return (
    // Разделы админки — таблицы: учётки, справочники, журнал. Это страницы,
    // на которых работают, а не читают (правило П34 канона), и плотность у
    // них объявляется один раз на экран, а не в каждом блоке.
    <PageLayout
      title={t(`${current}.title`)}
      intro={t(`${current}.intro`, { defaultValue: "" }) || undefined}
      width="wide"
      density="compact"
    >
      <div className="flex flex-col gap-section">
        {current === "users" && <UsersPanel chrome="screen" />}
        {current === "leads" && <LeadsPanel chrome="screen" />}
        {current === "dictionaries" && <DictionariesPanel chrome="screen" />}
        {current === "audit" && <AuditPanel chrome="screen" />}
      </div>
    </PageLayout>
  );
}

function sectionFromRoute(section: string | undefined): AdminSection {
  return section !== undefined && isAdminSection(section) ? section : "users";
}
