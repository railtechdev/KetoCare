import { TargetBar, formatGrams, formatKcal } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

interface Props {
  /** Набрано за день: калорийность и ОБЩИЕ углеводы (лимит режет по ним, ADR-0030) */
  kcal: number;
  carbs: number;
  /** Суточная норма назначения */
  kcalTarget: number;
  /** Лимит углеводов назначения */
  carbsLimit: number;
}

/**
 * Цели дня полосой (правило П40 канона): калорийность — цель, которую
 * НАБИРАЮТ, углеводы — предел, который нельзя превышать, и у них разный смысл
 * заполнения (`kind`).
 *
 * Одна на три экрана — итоги дня в меню, итоги дня на главной семьи и день в
 * сводке врача. Пока полоса стояла только в меню, один и тот же день на главной
 * и у врача показывался числом «осталось 910,5 ккал», которое складывали в уме,
 * а лимит углеводов там не показывался вовсе.
 *
 * Знак разницы решает только формулировку подсказки: превышение — не вердикт о
 * соответствии назначению, его выносит сервер (`dayVerdict` кита).
 */
export function DayTargetBars({ kcal, carbs, kcalTarget, carbsLimit }: Props) {
  const { t } = useTranslation("menu");

  const kcalLeft = kcalTarget - kcal;
  const carbsLeft = carbsLimit - carbs;

  return (
    <div className="flex flex-col gap-section">
      <TargetBar
        kind="goal"
        label={t("totals.kcalLabel")}
        value={kcal}
        target={kcalTarget}
        valueText={t("totals.kcalOfTarget", {
          value: formatKcal(kcal),
          target: formatKcal(kcalTarget),
        })}
        hint={
          kcalLeft >= 0
            ? t("totals.kcalLeft", { value: formatKcal(kcalLeft) })
            : t("totals.kcalOver", { value: formatKcal(-kcalLeft) })
        }
      />
      <TargetBar
        kind="limit"
        label={t("totals.carbsLabel")}
        value={carbs}
        target={carbsLimit}
        valueText={t("totals.carbsOfLimit", {
          value: formatGrams(carbs),
          limit: formatGrams(carbsLimit),
        })}
        hint={
          carbsLeft >= 0
            ? t("totals.carbsLeft", { value: formatGrams(carbsLeft) })
            : t("totals.carbsOver", { value: formatGrams(-carbsLeft) })
        }
      />
    </div>
  );
}
