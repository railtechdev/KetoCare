import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { AuditPanel } from "./AuditPanel";
import { DictionariesPanel } from "./DictionariesPanel";
import { LeadsPanel } from "./LeadsPanel";
import { ProductAnomaliesPanel } from "./ProductAnomaliesPanel";
import { ProductsPanel } from "./ProductsPanel";
import { ProductCategoriesPanel } from "../products/ProductCategoriesPanel";
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
 * Заголовок берётся у подраздела: «Учётные записи», «Журнал аудита» — а не
 * общее «Администрирование» с уточнением ниже. Экран отвечает на вопрос «где
 * я» первой строкой.
 *
 * Клинических данных здесь нет: администратор к ним доступа не имеет
 * (раздел 5.1 ТЗ), и сервер вырезает нагрузку клинических записей даже из
 * журнала аудита.
 */
export function AdminPage({ section }: { section?: string }) {
  const { t } = useTranslation("admin");

  const current = sectionFromRoute(section);

  return (
    <PageLayout
      title={t(`${current}.title`)}
      intro={t(`${current}.intro`, { defaultValue: "" }) || undefined}
    >
      <div className="flex flex-col gap-block">
        {current === "users" && <UsersPanel chrome="screen" />}
        {current === "leads" && <LeadsPanel chrome="screen" />}
        {current === "products" && (
          <>
            <ProductsPanel chrome="screen" />

            {/* Категории — часть того же справочника: заводить продукт можно
                только в существующую категорию, а до этого её нельзя было ни
                завести, ни переименовать, ни свести с одноимённой. */}
            <ProductCategoriesPanel />

            {/* Проверка базы на аномалии (раздел 10.1 ТЗ). Внизу раздела, а не
                вверху: это ревизия того, что уже загружено, а не ежедневная
                работа — иначе она оттесняла бы поиск продукта, ради которого
                сюда и заходят. */}
            <ProductAnomaliesPanel />
          </>
        )}
        {current === "dictionaries" && <DictionariesPanel chrome="screen" />}
        {current === "audit" && <AuditPanel chrome="screen" />}
      </div>
    </PageLayout>
  );
}

function sectionFromRoute(section: string | undefined): AdminSection {
  return section !== undefined && isAdminSection(section) ? section : "users";
}
