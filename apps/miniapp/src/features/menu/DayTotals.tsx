import {
  MacroBar,
  RatioBadge,
  Section,
  TargetBar,
  formatKcal,
  formatGrams,
} from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import type { Menu } from "./useMenu";

export interface DayTargets {
  kcalPerDay: number;
  carbsLimitG: number;
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
 * **Вердикта о соответствии назначению здесь нет.** То, что интерфейс говорит о
 * попадании дня в допуск, живёт одним куском в кабинете
 * (`features/patients/dayVerdict.ts`) и различает три причины, по которым
 * вердикта может не быть. Вторая реализация этого правила означала бы, что одна
 * и та же семья слышит о своём ребёнке разное в зависимости от того, откуда
 * смотрит. Переносить его в кит — отдельная работа; до неё экран показывает
 * числа и цели, а утверждений о допуске не делает.
 */
export function DayTotals({
  menu,
  targets,
}: {
  menu: Menu;
  targets: DayTargets | null;
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
        // Без `withinTolerance`: значок показывает число, но не утверждает, что
        // день в допуске — это вердикт, и его источник один (см. докстроку).
        <div className="self-start">
          <RatioBadge ratio={totals.ratio} />
        </div>
      )}

      <MacroBar
        fatG={totals.fat}
        proteinG={totals.protein}
        carbsG={totals.carbs}
        showGrams
      />

      {targets !== null && (
        <div className="flex flex-col gap-block">
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
    </Section>
  );
}
