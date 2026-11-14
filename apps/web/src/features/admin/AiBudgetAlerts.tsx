import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatCount, formatUsd } from "./format";
import type { AiBudgetAlert } from "./useAiSettings";

/**
 * Бюджеты, заполненные на 80 % и больше (ADR-0081).
 *
 * Почты в продукте нет, и администраторы не привязаны к Telegram: о бюджете
 * они узнают здесь — на главной и в разделе «Модели и расход». Прежде о нём
 * узнавали, когда он кончился, от семей с «лимит исчерпан».
 */
export function AiBudgetAlerts({ alerts }: { alerts: AiBudgetAlert[] }) {
  const { t } = useTranslation("admin");
  if (alerts.length === 0) return null;

  return (
    <ul
      className="m-0 flex list-none flex-col gap-2 p-0"
      aria-label={t("ai.alerts.label")}
    >
      {alerts.map((alert) => {
        const scope =
          alert.scope === "project"
            ? t("ai.alerts.project")
            : t(`ai.groups.${alert.scope}.title`);
        const values = {
          scope,
          budget: t(`ai.alerts.period.${alert.period}`),
          percent: formatCount(alert.percent),
          spent: formatUsd(alert.spent_usd),
          limit: formatUsd(alert.budget_usd),
        };
        const exhausted = alert.level === "exhausted";
        return (
          <li
            key={`${alert.scope}-${alert.period}`}
            className={`flex gap-2 rounded-lg border px-3.5 py-2.5 text-sm ${
              exhausted
                ? "border-destructive/40 bg-destructive/10"
                : "border-warning/40 bg-warning/10"
            }`}
          >
            <TriangleAlert
              aria-hidden="true"
              className={`mt-0.5 size-4 shrink-0 ${
                exhausted ? "text-destructive" : "text-warning-strong"
              }`}
            />
            <span>
              <span className="font-medium text-foreground">
                {exhausted
                  ? t("ai.alerts.exhausted", values)
                  : t("ai.alerts.warning", values)}
              </span>{" "}
              <span className="text-muted-foreground">
                {exhausted
                  ? t(
                      `ai.alerts.refused.${alert.scope === "project" ? "project" : "group"}`,
                      {
                        until: t(`ai.alerts.until.${alert.period}`),
                      },
                    )
                  : t("ai.alerts.raise")}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
