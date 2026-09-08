import { MacroBar, RatioBadge, Section, WarningBanner } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

export interface DishView {
  kcal: number;
  fat_g: number;
  protein_g: number;
  carbs_g: number;
  fiber_g: number;
  ratio: number | null;
  engine_version: string;
}

interface Props {
  dish: DishView;
  /** Вердикты приходят от сервера; допуск — медицинская константа ядра */
  ratioWithinTolerance?: boolean;
  kcalWithinTolerance?: boolean;
  /**
   * Откуда взялась цель, с которой сравнивают.
   *
   * `prescription` — из активного назначения ребёнка; `manual` — её задал
   * человек в полях расчёта. Разница не косметическая: без назначения вердикт
   * «выходит за допуски НАЗНАЧЕНИЯ» называет то, чего нет. Так и было видно на
   * экране, где назначения ещё не завели, — и стало видно всем специалистам,
   * когда калькулятор научился работать без выбранного ребёнка.
   */
  target?: "prescription" | "manual";
}

export function DishResultView({
  dish,
  ratioWithinTolerance,
  kcalWithinTolerance,
  target = "prescription",
}: Props) {
  const { t } = useTranslation("calculator");
  const offTolerance =
    ratioWithinTolerance === false || kcalWithinTolerance === false;

  return (
    <Section title={t("result")}>
      <div className="flex flex-wrap items-center gap-block">
        <RatioBadge ratio={dish.ratio} withinTolerance={ratioWithinTolerance} />
        <span className="tabular-nums">
          {t("kcalValue", { value: dish.kcal.toFixed(0) })}
        </span>
      </div>

      <MacroBar
        fatG={dish.fat_g}
        proteinG={dish.protein_g}
        carbsG={dish.carbs_g}
      />

      {offTolerance && (
        <WarningBanner
          level="warning"
          title={t(`offTolerance.${target}.title`)}
        >
          {t(`offTolerance.${target}.body`)}
        </WarningBanner>
      )}
      {/* Версия движка показывается рядом с результатом: расчёт, сделанный разными
        версиями ядра, может отличаться, и это должно быть видно. */}

      <p className="m-0 text-xs text-muted-foreground">
        {t("engineVersion", { version: dish.engine_version })}
      </p>
    </Section>
  );
}
