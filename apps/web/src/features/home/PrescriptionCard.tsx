import {
  formatGrams,
  EmptyState,
  Metric,
  MetricRow,
  RatioBadge,
  formatKcal,
  formatDayMonth,
  formatNumber,
  parseDateInput,
} from "@ketocare/ui";
import { ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Panel } from "./Panel";
import type { PrescriptionRead } from "./types";

/** Показатели одной версии назначения. */
function PrescriptionMetrics({
  prescription,
}: {
  prescription: PrescriptionRead;
}) {
  const { t } = useTranslation("home");
  return (
    <>
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
            value: formatKcal(prescription.kcal_per_day),
          })}
        />
        <Metric
          label={t("prescription.protein")}
          value={t("prescription.gramsValue", {
            value: formatGrams(prescription.protein_g),
          })}
        />
        <Metric
          label={t("prescription.carbsLimit")}
          value={t("prescription.gramsValue", {
            value: formatGrams(prescription.carbs_limit_g),
          })}
        />
        {/* Число приёмов врач задаёт с первого назначения, а семье его до сих
            пор не показывали нигде — при том что план дня составляет она. */}
        <Metric
          label={t("prescription.meals")}
          value={prescription.meals_per_day}
        />
        {/* Жидкость врач задаёт не всегда (ADR-0069): нет — нет и показателя. */}
        {prescription.fluid_ml_per_day != null && (
          <Metric
            label={t("prescription.fluid")}
            value={t("prescription.mlValue", {
              value: formatNumber(prescription.fluid_ml_per_day, 0),
            })}
          />
        )}
      </MetricRow>
    </>
  );
}

/**
 * Действующее назначение врача — цель, с которой семья сверяет день.
 *
 * Версия, у которой «Действует с» позже сегодня, стоит ниже с датой: день по
 * ней ещё не судится, но семья должна знать, с какого числа менять меню
 * (правило действующего назначения, аудит расчётов 13.11.2026).
 */
export function PrescriptionCard({
  prescription,
  upcoming = null,
}: {
  prescription: PrescriptionRead | null;
  upcoming?: PrescriptionRead | null;
}) {
  const { t } = useTranslation("home");
  const startsOn =
    upcoming === null ? null : parseDateInput(upcoming.effective_from);
  const upcomingBlock =
    upcoming === null || startsOn === null ? null : (
      <div className="flex flex-col gap-field">
        <p className="text-sm font-medium">
          {t("prescription.upcoming", { date: formatDayMonth(startsOn) })}
        </p>
        <PrescriptionMetrics prescription={upcoming} />
      </div>
    );

  if (prescription === null) {
    return (
      <Panel title={t("prescription.title")}>
        {upcomingBlock ?? (
          // Без кнопки действия намеренно: назначение задаёт врач, семье здесь
          // нечего нажать — обещать ей выход было бы неправдой.
          <EmptyState
            icon={ClipboardList}
            title={t("prescription.emptyTitle")}
            description={t("prescription.empty")}
          />
        )}
      </Panel>
    );
  }

  return (
    <Panel title={t("prescription.title")}>
      <div className="flex flex-col gap-section">
        <PrescriptionMetrics prescription={prescription} />
        {upcomingBlock}
      </div>
    </Panel>
  );
}
