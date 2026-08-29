import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { AuditPanel } from "./AuditPanel";
import { DictionariesPanel } from "./DictionariesPanel";
import { ProductsPanel } from "./ProductsPanel";
import { UsersPanel } from "./UsersPanel";
import { ADMIN_SECTIONS, isAdminSection, type AdminSection } from "./types";

/**
 * Администрирование (раздел 8.1 ТЗ: users, products, dictionaries, audit).
 *
 * Один экран на четыре подраздела: маршрут `/app/$section` не знает о вложенных
 * путях, поэтому подраздел приходит параметром, а дальше переключается
 * вкладками. Неизвестное значение параметра открывает учётные записи — пустой
 * экран администратору не помогает.
 *
 * Клинических данных здесь нет: администратор к ним доступа не имеет
 * (раздел 5.1 ТЗ), и сервер вырезает нагрузку клинических записей даже из
 * журнала аудита.
 */
export function AdminPage({ section }: { section?: string }) {
  const { t } = useTranslation("admin");

  const requested = sectionFromRoute(section);
  const [tab, setTab] = useState<AdminSection>(requested);
  const [routed, setRouted] = useState(section);

  // Переход по меню меняет параметр маршрута, а вкладка — состояние экрана;
  // без сверки с прошлым параметром клик по «Аудиту» в меню оставлял бы
  // открытой вкладку, выбранную руками.
  if (section !== routed) {
    setRouted(section);
    setTab(requested);
  }

  return (
    <PageLayout title={t("title")} intro={t("intro")}>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (isAdminSection(value)) setTab(value);
        }}
        className="gap-block"
      >
        {/* Четыре подписи не помещаются в 360 px, поэтому полоса вкладок
            прокручивается внутри себя, а не растягивает страницу. */}
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList aria-label={t("tabsLabel")}>
            {ADMIN_SECTIONS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(`tabs.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Содержимое неактивной вкладки не монтируется, поэтому запросы уходят
            только за открытым подразделом. */}
        <TabsContent value="users">
          <UsersPanel />
        </TabsContent>
        <TabsContent value="products">
          <ProductsPanel />
        </TabsContent>
        <TabsContent value="dictionaries">
          <DictionariesPanel />
        </TabsContent>
        <TabsContent value="audit">
          <AuditPanel />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}

function sectionFromRoute(section: string | undefined): AdminSection {
  return section !== undefined && isAdminSection(section) ? section : "users";
}
