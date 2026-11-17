import { useTranslation } from "react-i18next";

import { formatShortDate } from "./dates";
import type { DishUsageEntry } from "./useDishUsage";

/**
 * «В меню 12 нояб., 2 дн. · съедено 10 нояб.» под названием блюда в выборе.
 *
 * Только сведения, не запрет: повторить блюдо — обычное дело, ошибка — не
 * заметить, что оно уже было (ADR-0089).
 */
export function DishUsageNote({
  usage,
}: {
  usage: DishUsageEntry | undefined;
}) {
  const { t } = useTranslation("menu");
  if (usage === undefined) return null;

  return (
    <span className="block text-xs font-normal text-muted-foreground">
      {t("usage.planned", {
        date: formatShortDate(usage.last_date),
        count: usage.days,
      })}
      {usage.last_eaten != null &&
        ` · ${t("usage.eaten", { date: formatShortDate(usage.last_eaten) })}`}
    </span>
  );
}
