import { MacroBar, RatioBadge, cn } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import type { TargetsInput } from "./useCalcMutations";

export interface DishView {
  kcal: number;
  fat_g: number;
  protein_g: number;
  carbs_g: number;
  fiber_g: number;
  /** Углеводы за вычетом клетчатки: по ним считается соотношение */
  net_carbs_g: number;
  ratio: number | null;
  engine_version: string;
}

interface Props {
  dish: DishView;
  /**
   * Цель, с которой сравнивают. `null` — цели нет, и тогда показываются просто
   * числа: сравнивать не с чем, а придумывать за человека цель, чтобы было с
   * чем, — ровно та ошибка, из-за которой калькулятор объявлял негодным первый
   * же добавленный продукт.
   */
  goal: TargetsInput | null;
  /** Вердикты приходят от сервера; допуск — медицинская константа ядра */
  ratioWithinTolerance?: boolean;
  kcalWithinTolerance?: boolean;
}

/**
 * Показатели собранного блюда.
 *
 * Своего блока не заводит: стоит внутри «Расчёта», сразу под полями цели, —
 * так цель и факт читаются рядом. Тревоги здесь нет: пока блюдо собирают, оно
 * почти всегда мимо цели, и плашка «не годится» на каждом продукте мешала бы
 * его собирать. Предупреждение живёт там, где принимается решение, — у
 * сохранения.
 */
export function DishResultView({
  dish,
  goal,
  ratioWithinTolerance,
  kcalWithinTolerance,
}: Props) {
  const { t } = useTranslation("calculator");

  // Разница с целью — по калорийности: соотношение показывает значок, а
  // «на сколько промахнулись по калориям» иначе приходится считать в уме.
  const delta = goal === null ? null : Math.round(dish.kcal - goal.kcal);

  /**
   * Достигнута ли цель. `null` — сказать нечего: цели нет либо вердикт снят,
   * пока расчёт не догнал правку. Молчание честнее догадки: по этой строке
   * готовят еду ребёнку.
   */
  const verdict =
    goal === null ||
    ratioWithinTolerance === undefined ||
    kcalWithinTolerance === undefined
      ? null
      : ratioWithinTolerance && kcalWithinTolerance
        ? "within"
        : "off";

  return (
    <div className="flex flex-col gap-block">
      <div className="flex flex-wrap items-center gap-block">
        <RatioBadge ratio={dish.ratio} withinTolerance={ratioWithinTolerance} />
        <span className="tabular-nums">
          {t("kcalValue", { value: dish.kcal.toFixed(0) })}
        </span>
        {delta !== null && delta !== 0 && (
          <span
            // Цвет — из токенов темы: промах за допуск читается предупреждением,
            // попадание в него — обычной подписью.
            className={cn(
              "text-sm tabular-nums",
              kcalWithinTolerance === false
                ? "text-warning"
                : "text-muted-foreground",
            )}
          >
            {t(delta > 0 ? "result.above" : "result.below", {
              value: Math.abs(delta),
            })}
          </span>
        )}
      </div>

      {/* Состояние словом, а не только цветом: значок соотношения и разница в
          калориях уже красятся токенами, но цвет — не единственный признак
          (WCAG 1.4.1). Это НЕ тревога: пока блюдо собирают, оно почти всегда
          мимо цели, и плашка на каждом продукте мешала бы его собирать. Так же
          читается кабинет, к которому привыкла клиника: там строки Goal и
          Actual стоят рядом, и вывод человек делает сам. */}
      {verdict !== null && (
        <p
          role="status"
          className={cn(
            "m-0 text-sm",
            verdict === "within" ? "text-success" : "text-warning",
          )}
        >
          {t(verdict === "within" ? "result.within" : "result.off")}
        </p>
      )}

      <MacroBar
        fatG={dish.fat_g}
        proteinG={dish.protein_g}
        carbsG={dish.carbs_g}
        netCarbs={{
          grams: dish.net_carbs_g,
          label: t("netCarbs"),
          note: t("netCarbsNote"),
        }}
      />

      {/* Версия движка показывается рядом с результатом: расчёт, сделанный
          разными версиями ядра, может отличаться, и это должно быть видно. */}
      <p className="m-0 text-xs text-muted-foreground">
        {t("engineVersion", { version: dish.engine_version })}
      </p>
    </div>
  );
}
