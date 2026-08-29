import { useTranslation } from "react-i18next";

import { cn } from "@ketocare/ui";
import { SectionLink } from "../components/SectionLink";
import { SIDEBAR_HIDDEN_SECTIONS } from "../features/auth/roles";
import { SECTION_ICONS } from "../routes/sections";

/**
 * Разделы кабинета. Один список на боковую панель и на мобильную шторку —
 * иначе они расходятся, и на телефоне не хватает пункта, который есть на
 * широком экране.
 */
export function SidebarNav({
  sections,
  onNavigate,
}: {
  sections: readonly string[];
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <nav aria-label={t("app.name")} className="flex-1">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {sections
          .filter((section) => !SIDEBAR_HIDDEN_SECTIONS.includes(section))
          .map((section) => {
            const Icon = SECTION_ICONS[section];

            return (
              <li key={section}>
                <SectionLink
                  section={section}
                  className={cn(
                    "flex min-h-touch items-center gap-block rounded-lg px-3 text-sm font-medium",
                    "text-sidebar-foreground/80 no-underline transition-colors",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                  activeProps={{
                    className:
                      "bg-sidebar-accent text-sidebar-accent-foreground font-semibold",
                  }}
                  // Закрытие мобильной шторки висит на самой ссылке, а не на
                  // подписи внутри неё: тап по значку мимо текста не попадал в
                  // обработчик, и шторка оставалась открытой поверх раздела, в
                  // который пользователь только что перешёл.
                  onClick={onNavigate}
                >
                  {Icon && (
                    <Icon aria-hidden="true" className="size-5 shrink-0" />
                  )}
                  <span>{t(`nav.${section}`)}</span>
                </SectionLink>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}
