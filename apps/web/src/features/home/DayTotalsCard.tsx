import {
  MacroBar,
  RatioBadge,
  WarningBanner,
  dayVerdict,
  formatKcal,
  kcalToTarget,
  toleranceGapKey,
} from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { DayTargetBars } from "../menu/DayTargetBars";
import { Panel } from "./Panel";
import type { DaySummary } from "./types";

interface Props {
  day: DaySummary | null;
  /** Калорийность назначения — показывается рядом с фактом, для сравнения глазом */
  targetKcal: number | null;
  /** Лимит углеводов назначения; вместе с калорийностью даёт полосы целей */
  carbsLimit: number | null;
}

/**
 * Итоги дня против назначения (раздел 8.3 ТЗ).
 *
 * Вердикты о допусках берутся из ответа (`day.tolerance`): допуски —
 * медицинские константы ядра (правило 2 CLAUDE.md), их копия в TypeScript
 * разошлась бы с расчётом и показала бы «в норме» там, где ядро считает иначе.
 */
export function DayTotalsCard({ day, targetKcal, carbsLimit }: Props) {
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

  const verdict = dayVerdict(tolerance, day.tolerance_gap ?? null);
  const issues = verdict.ratioOffTolerance ? [t("day.offTolerance.ratio")] : [];

  return (
    <Panel title={t("day.title")}>
      <div className="flex flex-col gap-section">
        <div className="flex flex-wrap items-center gap-section">
          <RatioBadge
            ratio={totals.ratio}
            withinTolerance={tolerance?.ratio_within_tolerance ?? undefined}
          />
          <span className="tabular-nums">
            {targetKcal === null
              ? t("day.kcal", { value: formatKcal(totals.kcal) })
              : t("day.kcalOfTarget", {
                  value: formatKcal(totals.kcal),
                  target: formatKcal(targetKcal),
                })}
          </span>
        </div>

        <MacroBar
          fatG={totals.fat}
          proteinG={totals.protein}
          carbsG={totals.carbs}
        />

        {/* Цели полосой, как в меню (П40): тот же день на главной читался
            числом, которое складывали в уме, а лимит углеводов не показывался
            вовсе. «Добавьте ещё N ккал» говорит подсказка полосы — отдельной
            строкой это стояло бы дважды. */}
        {targetKcal !== null && carbsLimit !== null && (
          <DayTargetBars
            kcal={totals.kcal}
            carbs={totals.carbs}
            kcalTarget={targetKcal}
            carbsLimit={carbsLimit}
          />
        )}

        {verdict.unavailable ? (
          // Почему вердикта нет — словами сервера, а не догадкой экрана. Одним
          // текстом на все причины кабинет говорил семье «назначения нет» при
          // живом назначении; причины нет вовсе — текст нейтральный.
          <p className="m-0 text-sm text-muted-foreground">
            {t(`day.${toleranceGapKey(verdict.unavailableReason)}`)}
          </p>
        ) : issues.length > 0 ? (
          <WarningBanner level="warning" title={t("day.offTolerance.title")}>
            <ul className="m-0 list-disc pl-5">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </WarningBanner>
        ) : verdict.ratioUnknown ? (
          // Соотношения у дня нет — ни тревоги, ни похвалы: сказать нечего.
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {t("day.ratioUnknown")}
          </p>
        ) : (
          // Не тост: соответствие дня назначению — состояние, которое родитель
          // перечитывает, а не подтверждение действия (правило П16 канона).
          <p role="status" className="m-0 text-sm text-success">
            {t("day.withinTolerance")}
          </p>
        )}

        {/* Без полос (лимита нет) остаётся строка: набрать норму всё ещё нужно. */}
        {verdict.kcalBelowTarget &&
          targetKcal !== null &&
          carbsLimit === null && (
            <p className="m-0 text-sm text-muted-foreground">
              {t("day.kcalBelowTarget", {
                value: formatKcal(totals.kcal),
                target: formatKcal(targetKcal),
                left: formatKcal(kcalToTarget(totals.kcal, targetKcal)),
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
