import { Tabs, TabsBar, TabsContent } from "@ketocare/ui";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { AuditPanel } from "./AuditPanel";
import { DictionariesPanel } from "./DictionariesPanel";
import { LeadsPanel } from "./LeadsPanel";
import { ProductsPanel } from "./ProductsPanel";
import { UsersPanel } from "./UsersPanel";
import { ADMIN_SECTIONS, isAdminSection, type AdminSection } from "./types";

/**
 * Администрирование (раздел 8.1 ТЗ: users, products, dictionaries, audit).
 *
 * Один экран на четыре подраздела, но у каждого из них СВОЙ адрес
 * (`/app/users`, `/app/products`, `/app/dictionaries`, `/app/audit`) — они
 * перечислены и в меню кабинета. Неизвестное значение параметра открывает
 * учётные записи: пустой экран администратору не помогает.
 *
 * Поэтому вкладка не хранит выбор, а переходит по адресу (правило П29: другая
 * задача — отдельный адрес; правило П30: выбранное живёт в адресе). До этого
 * выбор жил в `useState`, и адрес расходился с содержимым: администратор,
 * открывший «Аудит» вкладкой, оставался на `/app/users` — переслать ссылку на
 * журнал было нельзя, а F5 возвращал на учётные записи.
 *
 * Клинических данных здесь нет: администратор к ним доступа не имеет
 * (раздел 5.1 ТЗ), и сервер вырезает нагрузку клинических записей даже из
 * журнала аудита.
 */
export function AdminPage({ section }: { section?: string }) {
  const { t } = useTranslation("admin");

  const navigate = useNavigate();
  const tab = sectionFromRoute(section);

  return (
    <PageLayout title={t("title")} intro={t("intro")}>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (!isAdminSection(value)) return;
          // Переход, а не состояние: адрес обязан совпадать с тем, что открыто.
          // `tab` и `kind` принадлежат покинутому подразделу — на новом они
          // означали бы уже другое, поэтому сбрасываются (как в SectionLink).
          void navigate({
            to: "/app/$section",
            params: { section: value },
            search: (previous) => ({
              ...previous,
              tab: undefined,
              kind: undefined,
            }),
          });
        }}
        className="gap-block"
      >
        {/* Оформление полосы вкладок — общее для приложения: на шесть наборов
            вкладок приходилось четыре разных набора классов и три ответа на
            «что делать, когда не помещаются» (правило П29). */}
        <TabsBar
          label={t("tabsLabel")}
          items={ADMIN_SECTIONS.map((value) => ({
            value,
            label: t(`tabs.${value}`),
          }))}
        />

        {/* Содержимое неактивной вкладки не монтируется, поэтому запросы уходят
            только за открытым подразделом. */}
        <TabsContent value="users">
          <UsersPanel />
        </TabsContent>
        <TabsContent value="leads">
          <LeadsPanel />
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
