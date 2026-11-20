import { useTranslation } from "react-i18next";

import {
  CookingSteps,
  SheetHeading,
  SheetMetrics,
  SheetNotice,
  WeighTable,
  type SheetMetric,
  type WeighLine,
} from "./SheetParts";

/**
 * Карточка блюда на бумаге (ADR-0088, ADR-0092): что взвесить — таблицей с
 * квадратами «взвешено», как готовить — по шагам. Одна на калькулятор и на
 * неделю меню: семья держит в руках один и тот же лист, откуда бы он ни пришёл.
 */
export function DishCard({
  kicker,
  title,
  metrics = [],
  lines,
  seasonings,
  steps,
  footnote,
}: {
  kicker?: string;
  title: string;
  metrics?: readonly SheetMetric[];
  lines: readonly WeighLine[];
  seasonings?: readonly string[];
  steps?: string | null;
  footnote?: string;
}) {
  const { t } = useTranslation("common");
  return (
    <div className="flex flex-col gap-[5mm] text-[12pt] leading-snug">
      <SheetHeading kicker={kicker} title={title} />
      {metrics.length > 0 && <SheetMetrics metrics={metrics} />}
      <SheetNotice tone="info" title={t("print.weighTitle")}>
        {t("print.weighText")}
      </SheetNotice>
      <WeighTable lines={lines} seasonings={seasonings} />
      <CookingSteps text={steps} />
      <SheetNotice tone="warning" title={t("print.importantTitle")}>
        {t("print.importantText")}
      </SheetNotice>
      {footnote !== undefined && (
        <p className="m-0 text-[9pt] text-[#4a5263]">{footnote}</p>
      )}
    </div>
  );
}
