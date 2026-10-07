import {
  MacroBar,
  RatioBadge,
  Section,
  TargetBar,
  formatKcal,
  formatGrams,
  type DayTolerance,
  type ToleranceGap,
} from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { DayVerdictNote } from "./DayVerdictNote";
import type { Menu } from "./useMenu";

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

/**
 * Итоги дня рядом с целями назначения.
 *
 * Показывать одни макронутриенты стало нельзя с того дня, как день начали
 * собирать здесь: до этого семья смотрела на план, составленный в кабинете, где
 * цели видно. Собирать день, не видя, попадает ли он в назначение, — это
 * собирать вслепую, а речь о суточном рационе ребёнка на терапии.
 *
 * Числа и цели те же, что в кабинете (`features/menu/DayTotalsPanel.tsx`), и
 * примитивы те же — `TargetBar` и `RatioBadge` кита. Калорийность — цель,
 * которую НАБИРАЮТ, углеводы — предел, который нельзя превышать: у них разный
 * смысл заполнения, и `kind` это различает.
 *
 * **Вердикт о соответствии назначению — с 05.10.2026 и здесь**, тем же
 * правилом, что в кабинете: `dayVerdict` переехал в кит (`DayVerdictNote`).
 * Готовый вердикт сервер отдаёт только за сегодня и только в `/overview`, поэтому
 * его приносит экран (`verdict`), а не план дня: у `GET /menus` вердикта нет.
 */
export function DayTotals({
  menu,
  targets,
  verdict,
}: {
  menu: Menu;
  targets: DayTargets | null;
  verdict: DayVerdictInput;
}) {
  const { t } = useTranslation();
  const totals = menu.totals;
  if (totals === null || totals === undefined) return null;

  return (
    <Section title={t("menu.totals")} density="compact">
      {totals.ratio !== null && totals.ratio !== undefined && (
        // `self-start`: содержимое `Section` — колонка flex, и значок без него
        // растягивается во всю ширину, переставая читаться как значок.
        //
        // Цвет допуска — только из вердикта сервера за этот же день; для
        // других дней значок показывает одно число.
        <div className="self-start">
          <RatioBadge
            ratio={totals.ratio}
            withinTolerance={
              verdict.otherDay
                ? undefined
                : (verdict.tolerance?.ratio_within_tolerance ?? undefined)
            }
          />
        </div>
      )}

      <MacroBar
        fatG={totals.fat}
        proteinG={totals.protein}
        carbsG={totals.carbs}
        showGrams
      />

      {targets !== null && (
        <div className="flex flex-col gap-section">
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
