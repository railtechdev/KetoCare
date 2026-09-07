import { EmptyState, Metric, MetricRow, RatioBadge } from "@ketocare/ui";
import { ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Panel } from "./Panel";
import type { PrescriptionRead } from "./types";

/** Активное назначение врача — цель, с которой семья сверяет день. */
export function PrescriptionCard({
  prescription,
}: {
  prescription: PrescriptionRead | null;
}) {
  const { t } = useTranslation("home");

  if (prescription === null) {
    return (
      <Panel title={t("prescription.title")}>
        {/* Без кнопки действия намеренно: назначение задаёт врач, семье здесь
            нечего нажать — обещать ей выход было бы неправдой. */}
        <EmptyState
          icon={ClipboardList}
          title={t("prescription.emptyTitle")}
          description={t("prescription.empty")}
        />
      </Panel>
    );
  }

  return (
    <Panel title={t("prescription.title")}>
      {/* Показатели рядом, сколько влезет. Раньше здесь было
          `sm:grid-cols-2` — вопрос о ширине ОКНА: в приставной колонке 20rem на
          мониторе 1920 блок оставался двухстолбцовым, и «Кетосоотношение» с
          «Калорийностью» жались в 130 px каждый. `MetricRow` спрашивает о
          ширине самого блока. */}
      <MetricRow label={t("prescription.title")}>
        {/* Без вердикта о допуске: это назначенная цель, а не измеренный
            результат, сравнивать её не с чем. */}
        <Metric
          label={t("prescription.ratio")}
          value={<RatioBadge ratio={prescription.ratio} />}
        />
        <Metric
          label={t("prescription.kcal")}
          value={t("prescription.kcalValue", {
            value: prescription.kcal_per_day.toFixed(0),
          })}
        />
        <Metric
          label={t("prescription.protein")}
          value={t("prescription.gramsValue", {
            value: prescription.protein_g,
          })}
        />
        <Metric
          label={t("prescription.carbsLimit")}
          value={t("prescription.gramsValue", {
            value: prescription.carbs_limit_g,
          })}
        />
        {/* Число приёмов врач задаёт с первого назначения, а семье его до сих
            пор не показывали нигде — при том что план дня составляет она. */}
        <Metric
          label={t("prescription.meals")}
          value={prescription.meals_per_day}
        />
      </MetricRow>
    </Panel>
  );
}
