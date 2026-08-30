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
    // Пустое состояние на экране одно (правило П27 канона). Об отсутствующем
    // меню уже сказал блок «Ближайший приём пищи» выше — он же предлагает его
    // составить. Второй такой же блок с той же кнопкой занимал высоту ради
    // повторения того, что читатель только что прочёл, поэтому здесь остаётся
    // строка.
    return (
      <Panel title={t("day.title")}>
        <p className="m-0 text-sm text-muted-foreground">{t("day.empty")}</p>
      </Panel>
    );
  }

  const { totals } = day;
  const tolerance = day.tolerance ?? null;

  const verdict = dayVerdict(tolerance);
  const issues = verdict.ratioOffTolerance ? [t("day.offTolerance.ratio")] : [];

  return (
    <Panel title={t("day.title")}>
      <div className="flex flex-col gap-block">
        <div className="flex flex-wrap items-center gap-block">
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
          fatG={totals.fat}
          proteinG={totals.protein}
          carbsG={totals.carbs}
        />

        {verdict.unavailable ? (
          <p className="m-0 text-sm text-muted-foreground">
            {t("day.noPrescription")}
          </p>
        ) : issues.length > 0 ? (
          <WarningBanner level="warning" title={t("day.offTolerance.title")}>
            <ul className="m-0 list-disc pl-5">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </WarningBanner>
        ) : (
          // Не тост: соответствие дня назначению — состояние, которое родитель
          // перечитывает, а не подтверждение действия (правило П16 канона).
          <p role="status" className="m-0 text-sm text-success">
            {t("day.withinTolerance")}
          </p>
        )}

        {verdict.kcalBelowTarget && targetKcal !== null && (
          <p className="m-0 text-sm text-muted-foreground">
            {t("day.kcalBelowTarget", {
              value: totals.kcal.toFixed(0),
              target: targetKcal.toFixed(0),
            })}
          </p>
        )}

        {/* Версия ядра показывается рядом с числами: итоги, посчитанные разными
            версиями, могут отличаться, и это должно быть видно. */}
        {day.engine_version && (
          <p className="m-0 text-xs text-muted-foreground">
            {t("day.engineVersion", { version: day.engine_version })}
          </p>
        )}
      </div>
    </Panel>
  );
}
