import {
  RatioBadge,
  Section,
  TargetBar,
  formatGrams,
  formatKcal,
  type DayTolerance,
  type ToleranceGap,
} from "@ketocare/ui";
import type { components } from "@ketocare/api-client";
import { useTranslation } from "react-i18next";

import { DayVerdictNote } from "./DayVerdictNote";

export interface DayTargets {
  kcalPerDay: number;
  carbsLimitG: number;
}

/** Вердикт сервера за показанный день — или «день не сегодняшний». */
export interface DayVerdictInput {
  tolerance: DayTolerance | null;
  gap: ToleranceGap | null;
  /** Вердикт сервер считает только за сегодня: для других дней его нет вовсе. */
  otherDay: boolean;
}

export type DayTotalsValues = components["schemas"]["DishComputed"];

/**
 * Итоги дня рядом с целями назначения — ОДНИМ компактным блоком.
 *
 * Калорийность здесь названа один раз — полосой «850 из 1 200 ккал» с
 * подсказкой «добавьте ещё N». Прежде она стояла в одной карточке трижды:
 * полосой макронутриентов, полосой цели и строкой вердикта (аудит 12.11.2026,
 * ADR-0075). Жиры, белки и углеводы — одной строкой граммов, без своей
 * калорийности.
 *
 * Калорийность — цель, которую НАБИРАЮТ, углеводы — предел, который нельзя
 * превышать: у них разный смысл заполнения, и `kind` это различает. Цвет
 * кетосоотношения — только из вердикта сервера за этот же день (`dayVerdict`
 * кита, тот же, что в кабинете).
 */
export function DayTotals({
  totals,
  targets,
  verdict,
}: {
  totals: DayTotalsValues | null | undefined;
  targets: DayTargets | null;
  verdict: DayVerdictInput;
}) {
  const { t } = useTranslation();
  if (totals === null || totals === undefined) return null;

  return (
    <Section title={t("menu.totals")} density="compact">
      <div className="flex flex-wrap items-center gap-field">
        <RatioBadge
          ratio={totals.ratio ?? null}
          withinTolerance={
            verdict.otherDay
              ? undefined
              : (verdict.tolerance?.ratio_within_tolerance ?? undefined)
          }
        />
        <span className="text-sm text-muted-foreground tabular-nums">
          {t("menu.macroLine", {
            fat: formatGrams(totals.fat),
            protein: formatGrams(totals.protein),
            carbs: formatGrams(totals.carbs),
          })}
        </span>
      </div>

      {targets === null ? (
        <p className="m-0 tabular-nums">
          {t("menu.compose.kcal", { value: formatKcal(totals.kcal) })}
        </p>
      ) : (
        <div className="flex flex-col gap-field">
          <TargetBar
            kind="goal"
            label={t("menu.targets.kcalLabel")}
            value={totals.kcal}
            target={targets.kcalPerDay}
            valueText={t("menu.targets.kcalOfTarget", {
              value: formatKcal(totals.kcal),
              target: formatKcal(targets.kcalPerDay),
            })}
            hint={
              totals.kcal <= targets.kcalPerDay
                ? t("menu.targets.kcalLeft", {
                    value: formatKcal(targets.kcalPerDay - totals.kcal),
                  })
                : t("menu.targets.kcalOver", {
                    value: formatKcal(totals.kcal - targets.kcalPerDay),
                  })
            }
          />
          <TargetBar
            kind="limit"
            label={t("menu.targets.carbsLabel")}
            value={totals.carbs}
            target={targets.carbsLimitG}
            valueText={t("menu.targets.carbsOfLimit", {
              value: formatGrams(totals.carbs),
              limit: formatGrams(targets.carbsLimitG),
            })}
            hint={
              totals.carbs <= targets.carbsLimitG
                ? t("menu.targets.carbsLeft", {
                    value: formatGrams(targets.carbsLimitG - totals.carbs),
                  })
                : t("menu.targets.carbsOver", {
                    value: formatGrams(totals.carbs - targets.carbsLimitG),
                  })
            }
          />
        </div>
      )}

      {/* Калорийность уже названа полосой: вердикт говорит только о
          кетосоотношении (`kcalHint` выключен, пока цель известна). */}
      <DayVerdictNote
        tolerance={verdict.tolerance}
        gap={verdict.gap}
        otherDay={verdict.otherDay}
        kcal={totals.kcal}
        targetKcal={targets?.kcalPerDay ?? null}
        kcalHint={targets === null}
      />
    </Section>
  );
}
