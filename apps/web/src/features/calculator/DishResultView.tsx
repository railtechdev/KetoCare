import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  MacroBar,
  RatioBadge,
  WarningBanner,
} from "@ketocare/ui";
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
}

export function DishResultView({
  dish,
  ratioWithinTolerance,
  kcalWithinTolerance,
}: Props) {
  const { t } = useTranslation("calculator");
  const offTolerance =
    ratioWithinTolerance === false || kcalWithinTolerance === false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-card-title">{t("result")}</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-block">
        <div className="flex flex-wrap items-center gap-block">
          <RatioBadge
            ratio={dish.ratio}
            withinTolerance={ratioWithinTolerance}
          />
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
          <WarningBanner level="warning" title={t("offTolerance.title")}>
            {t("offTolerance.body")}
          </WarningBanner>
        )}
      </CardContent>

      {/* Версия движка показывается рядом с результатом: расчёт, сделанный разными
          версиями ядра, может отличаться, и это должно быть видно. */}
      <CardFooter>
        <p className="m-0 text-xs text-muted-foreground">
          {t("engineVersion", { version: dish.engine_version })}
        </p>
      </CardFooter>
    </Card>
  );
}
