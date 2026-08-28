import { MacroBar, RatioBadge, WarningBanner } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { dayVerdict } from "../patients/dayVerdict";
import { Panel } from "./Panel";
import type { DaySummary } from "./types";

interface Props {
  day: DaySummary | null;
  /** Калорийность назначения — показывается рядом с фактом, для сравнения глазом */
  targetKcal: number | null;
}

/**
 * Итоги дня против назначения (раздел 8.3 ТЗ).
 *
 * Вердикты о допусках берутся из ответа (`day.tolerance`): допуски —
 * медицинские константы ядра (правило 2 CLAUDE.md), их копия в TypeScript
 * разошлась бы с расчётом и показала бы «в норме» там, где ядро считает иначе.
 */
export function DayTotalsCard({ day, targetKcal }: Props) {
  const { t } = useTranslation("home");

  if (day === null) {
    return (
      <Panel title={t("day.title")}>
        <p className="m-0 text-muted-foreground">{t("day.empty")}</p>
      </Panel>
    );
  }

  const { totals } = day;
  const tolerance = day.tolerance ?? null;

  const verdict = dayVerdict(tolerance);
  const issues = verdict.ratioOffTolerance ? [t("day.offTolerance.ratio")] : [];

  return (
    <Panel title={t("day.title")}>
      <div className="flex flex-wrap items-center gap-4">
        <RatioBadge
          ratio={totals.ratio}
          withinTolerance={tolerance?.ratio_within_tolerance}
        />
        <span className="tabular-nums">
          {targetKcal === null
            ? t("day.kcal", { value: totals.kcal.toFixed(0) })
            : t("day.kcalOfTarget", {
                value: totals.kcal.toFixed(0),
                target: targetKcal.toFixed(0),
              })}
        </span>
      </div>

      <MacroBar
        className="mt-4"
        fatG={totals.fat}
        proteinG={totals.protein}
        carbsG={totals.carbs}
      />

      {verdict.unavailable ? (
        <p className="m-0 mt-4 text-sm text-muted-foreground">
          {t("day.noPrescription")}
        </p>
      ) : issues.length > 0 ? (
        <WarningBanner
          className="mt-4"
          level="warning"
          title={t("day.offTolerance.title")}
        >
          <ul className="m-0 list-disc pl-5">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </WarningBanner>
      ) : (
        <p role="status" className="m-0 mt-4 text-sm text-success">
          {t("day.withinTolerance")}
        </p>
      )}

      {verdict.kcalBelowTarget && targetKcal !== null && (
        <p className="m-0 mt-3 text-sm text-muted-foreground">
          {t("day.kcalBelowTarget", {
            value: totals.kcal.toFixed(0),
            target: targetKcal.toFixed(0),
          })}
        </p>
      )}

      {/* Версия ядра показывается рядом с числами: итоги, посчитанные разными
          версиями, могут отличаться, и это должно быть видно. */}
      {day.engine_version && (
        <p className="m-0 mt-3 text-xs text-muted-foreground">
          {t("day.engineVersion", { version: day.engine_version })}
        </p>
      )}
    </Panel>
  );
}
