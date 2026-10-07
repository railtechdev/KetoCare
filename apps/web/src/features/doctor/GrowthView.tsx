import {
  AsyncSection,
  Badge,
  EmptyState,
  Metric,
  MetricRow,
  Section,
  formatNumber,
  formatWeight,
} from "@ketocare/ui";
import { Ruler } from "lucide-react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { formatIsoDate } from "./dates";
import { LinesSkeleton } from "./skeletons";
import { useGrowth, type GrowthIndicator } from "./therapyCourse";
import { queryState } from "../../lib/queryState";

type Score = { z: number; percentile: number } | null | undefined;

/** «−1,25 SD · 11-й перцентиль» — z-балл и перцентиль рядом (вопрос 15). */
function useScoreText() {
  const { t } = useTranslation("doctor");
  return (score: Score): string =>
    score
      ? t("growth.score", {
          z: formatNumber(score.z, 2),
          percentile: formatNumber(score.percentile, 1),
        })
      : t("growth.noScore");
}

/**
 * Рост и вес относительно нормы ВОЗ (вопрос 15, ADR-0050).
 *
 * Ответ клиники: «Считать по ВОЗ, врачу показать оба (перцентиль и z-балл).
 * Снижение соответствующего z-балла на ≥ 1,0 SD от исходного значения считать
 * значимым и выводить врачу». Считает сервер по таблицам ВОЗ; своей арифметики
 * здесь нет.
 */
export function GrowthView({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const growth = useGrowth(patientId);
  const scoreText = useScoreText();
  const points = growth.data?.points ?? [];

  return (
    <>
      <Section
        title={t("growth.summaryTitle")}
        description={t("growth.summaryDescription", {
          threshold: formatNumber(growth.data?.significant_drop_sd ?? 1, 1),
        })}
        density="compact"
      >
        <AsyncSection
          {...queryState(growth)}
          skeleton={<LinesSkeleton label={t("growth.loading")} lines={3} />}
          error={
            growth.isError
              ? {
                  title: t("growth.loadError"),
                  description:
                    errorMessageOf(growth.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void growth.refetch()}
          isEmpty={points.length === 0}
          empty={
            <EmptyState
              icon={Ruler}
              title={t("growth.empty")}
              description={t("growth.emptyDescription")}
            />
          }
        >
          <MetricRow>
            {(growth.data?.indicators ?? []).map((indicator) => (
              <IndicatorMetric
                key={indicator.indicator}
                indicator={indicator}
              />
            ))}
          </MetricRow>
          <p className="m-0 mt-2 text-xs text-muted-foreground">
            {t("growth.source", { source: growth.data?.source ?? "" })}
          </p>
        </AsyncSection>
      </Section>

      {points.length > 0 && (
        <Section title={t("growth.tableTitle")} density="compact">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-normal">
                    {t("growth.columns.date")}
                  </th>
                  <th className="py-1 pr-3 font-normal">
                    {t("growth.columns.weight")}
                  </th>
                  <th className="py-1 pr-3 font-normal">
                    {t("growth.columns.height")}
                  </th>
                  <th className="py-1 pr-3 font-normal">
                    {t("growth.indicators.wfa")}
                  </th>
                  <th className="py-1 pr-3 font-normal">
                    {t("growth.indicators.hfa")}
                  </th>
                  <th className="py-1 font-normal">
                    {t("growth.indicators.bmi")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().map((point, index) => (
                  <tr
                    key={`${point.measured_on}-${index}`}
                    className="border-t border-border"
                  >
                    <td className="py-1 pr-3 tabular-nums">
                      {formatIsoDate(point.measured_on) ?? point.measured_on}
                    </td>
                    <td className="py-1 pr-3 tabular-nums">
                      {t("growth.kg", { value: formatWeight(point.weight_kg) })}
                    </td>
                    <td className="py-1 pr-3 tabular-nums">
                      {point.height_cm === null || point.height_cm === undefined
                        ? t("growth.noScore")
                        : t("growth.cm", {
                            value: formatNumber(point.height_cm, 1),
                          })}
                    </td>
                    <td className="py-1 pr-3 tabular-nums">
                      {scoreText(point.wfa)}
                    </td>
                    <td className="py-1 pr-3 tabular-nums">
                      {scoreText(point.hfa)}
                    </td>
                    <td className="py-1 tabular-nums">
                      {scoreText(point.bmi_for_age)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}

function IndicatorMetric({ indicator }: { indicator: GrowthIndicator }) {
  const { t } = useTranslation("doctor");
  const scoreText = useScoreText();
  const label = t(`growth.indicators.${indicator.indicator}`);

  if (!indicator.latest) {
    return <Metric label={label} value={t("growth.noScore")} />;
  }

  return (
    <Metric
      label={label}
      value={scoreText(indicator.latest)}
      hint={
        <span className="flex flex-wrap items-center gap-2">
          {indicator.change_sd === null || indicator.change_sd === undefined
            ? t("growth.noBaseline")
            : t("growth.change", {
                change: formatNumber(indicator.change_sd, 2),
                date: indicator.baseline_on
                  ? (formatIsoDate(indicator.baseline_on) ??
                    indicator.baseline_on)
                  : "",
              })}
          {indicator.significant_drop && (
            <Badge variant="destructive">{t("growth.significantDrop")}</Badge>
          )}
        </span>
      }
    />
  );
}
