import { useTranslation } from "react-i18next";

import { Tooltip, TooltipContent, TooltipTrigger, cn } from "@ketocare/ui";
import { SectionLink } from "../components/SectionLink";
import { SIDEBAR_HIDDEN_SECTIONS } from "../features/auth/roles";
import {
  SECTION_GROUP_ORDER,
  SECTION_ICONS,
  getSectionGroup,
} from "../routes/sections";

/**
 * Разделы кабинета. Один список на боковую панель и на мобильную шторку —
 * иначе они расходятся, и на телефоне не хватает пункта, который есть на
 * широком экране.
 *
 * Между 768 и 1024 px панель — узкая рельса (Rail): каждый пункт отображает
 * вертикальную пару из иконки и короткой подписи, убирая «слепую зону» из одних
 * значков. На широких экранах (с 1024 px) разделы группируются по смысловым
 * блокам с заголовками групп.
 *
 * В шторке подписи видны всегда с группировкой: она открывается на телефоне,
 * где места по ширине столько же, сколько у широкой панели.
 */
export function SidebarNav({
  sections,
  onNavigate,
  labels = "responsive",
}: {
  sections: readonly string[];
  onNavigate?: () => void;
  /**
   * `responsive` — подписи под иконками на 768–1024 px, полное меню с 1024 px;
   * `always` — подписи и заголовки групп видны всегда (мобильная шторка);
   * `never` — только значки на любой ширине (панель внутри карты пациента:
   * место отдано навигации самого пациента).
   */
  labels?: "responsive" | "always" | "never";
}) {
  const { t } = useTranslation();
  const iconsOnly = labels !== "always";

  const visibleSections = sections.filter(
    (section) => !SIDEBAR_HIDDEN_SECTIONS.includes(section),
  );

  const grouped = SECTION_GROUP_ORDER.map((group) => ({
    group,
    items: visibleSections.filter(
      (section) => getSectionGroup(section) === group,
    ),
  })).filter((entry) => entry.items.length > 0);

  // Гарантируем отображение любых неклассифицированных разделов
  const groupedKeys = new Set(grouped.flatMap((g) => g.items));
  const unclassified = visibleSections.filter((s) => !groupedKeys.has(s));
  if (unclassified.length > 0) {
    grouped.push({ group: "management", items: unclassified });
  }

  return (
    <nav aria-label={t("app.name")} className="flex-1 overflow-y-auto">
      <div className="flex flex-col gap-1">
        {grouped.map(({ group, items }, groupIndex) => (
          <div key={group} className="flex flex-col">
            {groupIndex > 0 && (
              <div
                className={cn(
                  "my-1.5 h-px bg-sidebar-border/60",
                  labels === "responsive" && "lg:hidden",
                  labels === "always" && "hidden",
                )}
                aria-hidden="true"
              />
            )}
            {(labels === "always" || labels === "responsive") && (
              <div
                className={cn(
                  "px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground select-none",
                  groupIndex === 0 ? "pt-1" : "pt-4",
                  labels === "responsive" && "hidden lg:block",
                )}
              >
                {t(`nav.groups.${group}`)}
              </div>
            )}
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {items.map((section) => {
                const Icon = SECTION_ICONS[section];
                const label = t(`nav.${section}`);

                const link = (
                  <SectionLink
                    section={section}
                    title={iconsOnly ? label : undefined}
                    className={cn(
                      "flex min-h-touch items-center rounded-lg font-medium transition-colors no-underline",
                      "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      labels === "never" && "justify-center px-0 text-sm",
                      labels === "always" &&
                        "justify-start gap-section px-3 text-sm",
                      labels === "responsive" &&
                        "flex-col justify-center px-1 py-1.5 text-center gap-0.5 lg:flex-row lg:justify-start lg:gap-section lg:px-3 lg:py-2 lg:text-left text-sm",
                    )}
                    // Карта пациента лежит внутри своего раздела
                    // (`/app/patients/<id>/…`), и роутер считает пункт «Пациенты»
                    // открытым по началу пути. Это верно: врач, работающий в
                    // карте, находится именно в этом разделе — и видит по меню,
                    // где он.
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
                    <span
                      className={cn(
                        labels === "never" && "sr-only",
                        labels === "always" && "truncate",
                        labels === "responsive" &&
                          "w-full truncate text-center text-[11px] leading-tight lg:w-auto lg:truncate-none lg:text-left lg:text-sm",
                      )}
                    >
                      {label}
                    </span>
                  </SectionLink>
                );

                return (
                  <li key={section}>
                    {iconsOnly ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent
                          side="right"
                          className={cn(labels === "responsive" && "lg:hidden")}
                        >
                          {label}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
