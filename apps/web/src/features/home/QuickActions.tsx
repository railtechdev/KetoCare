import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

/**
 * Три быстрые кнопки (раздел 8.3 ТЗ). Ведут туда, куда родитель заходит
 * ежедневно: заполнить меню, записать замер, посчитать блюдо.
 */
const ACTIONS = ["menu", "diary", "calculator"] as const;

export function QuickActions() {
  const { t } = useTranslation("home");

  return (
    <nav aria-label={t("quickActions.title")}>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3">
        {ACTIONS.map((section) => (
          <li key={section}>
            <Link
              to="/app/$section"
              params={{ section }}
              className="flex min-h-touch items-center justify-center rounded-kc bg-accent px-4 text-center font-semibold text-on-accent no-underline shadow-kc-sm"
            >
              {t(`quickActions.${section}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
