import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { ProductsPanel } from "../admin/ProductsPanel";
import { ProductCategoriesPanel } from "./ProductCategoriesPanel";

/**
 * Справочник продуктов для того, кто его ведёт, — но вне раздела
 * администрирования.
 *
 * Диетологу сервер разрешает заводить и править продукты
 * (`_EDITOR_ROLES = (ADMIN, DIETITIAN)` в `routers/products.py`), а кабинет
 * отдавал ему тот же экран на чтение, что и родителю. Роль, чья работа и есть
 * вести каталог, не могла в нём ничего изменить.
 *
 * Отдельный экран, а не вкладка администрирования: соседние вкладки там —
 * учётные записи, заявки и журнал аудита, и все они закрыты ролью admin.
 * Показывать их диетологу значило бы вести его в 403 (правило П3 канона).
 *
 * Импорт CSV за админом: `POST /products/import` закрыт `require_roles(ADMIN)`,
 * тогда как править каталог вправе и диетолог. Панель получает это
 * возможностью (`canImport={false}` ниже), а не вычисляет роль сама. История
 * правок под этот запрет НЕ попадает: она открыта администратору, диетологу и
 * врачу (`_HISTORY_ROLES`), и панель показывает её всем, кто до неё дошёл.
 */
export function CatalogPage() {
  const { t } = useTranslation("products");

  return (
    <PageLayout title={t("catalog.title")} intro={t("catalog.intro")}>
      <ProductsPanel canImport={false} chrome="screen" />

      {/* Категории ведёт тот же, кто ведёт каталог: сервер разрешает правку
          диетологу наравне с администратором (`_EDITOR_ROLES`), а до этого
          справочник категорий не был доступен ни одной роли. */}
      <ProductCategoriesPanel />
    </PageLayout>
  );
}
