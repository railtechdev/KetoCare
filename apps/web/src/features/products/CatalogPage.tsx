import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { ProductsPanel } from "../admin/ProductsPanel";

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
 * Импорт CSV и история правок тоже за админом — панель получает это
 * возможностями, а не вычисляет роль сама: решение о правах принимается в
 * одном месте, в `sections.tsx`.
 */
export function CatalogPage() {
  const { t } = useTranslation("products");

  return (
    <PageLayout title={t("catalog.title")} intro={t("catalog.intro")}>
      <ProductsPanel canImport={false} chrome="screen" />
    </PageLayout>
  );
}
