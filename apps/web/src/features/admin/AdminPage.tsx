import * as Tabs from "@radix-ui/react-tabs";
import { useState } from "react";
import { useTranslation } from "react-i18next";

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
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t("title")}</h1>
        <p className="mt-1 mb-0 text-muted">{t("intro")}</p>
      </header>

      <Tabs.Root
        value={tab}
        onValueChange={(value) => {
          if (isAdminSection(value)) setTab(value);
        }}
      >
        <Tabs.List
          aria-label={t("tabsLabel")}
          className="flex flex-wrap gap-2 border-b border-line"
        >
          {ADMIN_SECTIONS.map((value) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="min-h-touch px-4 text-ink data-[state=active]:border-b-2 data-[state=active]:border-accent data-[state=active]:font-semibold"
            >
              {t(`tabs.${value}`)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Содержимое неактивной вкладки не монтируется, поэтому запросы уходят
            только за открытым подразделом. */}
        <Tabs.Content value="users" className="pt-2">
          <UsersPanel />
        </Tabs.Content>
        <Tabs.Content value="products" className="pt-2">
          <ProductsPanel />
        </Tabs.Content>
        <Tabs.Content value="dictionaries" className="pt-2">
          <DictionariesPanel />
        </Tabs.Content>
        <Tabs.Content value="audit" className="pt-2">
          <AuditPanel />
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}

function sectionFromRoute(section: string | undefined): AdminSection {
  return section !== undefined && isAdminSection(section) ? section : "users";
}
