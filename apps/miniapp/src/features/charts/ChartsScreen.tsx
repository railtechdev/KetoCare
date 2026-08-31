import { AsyncSection, Section, TrendChart, WarningBanner } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import type { Session } from "../session/useSession";
import {
  TREND_DAYS,
  type TrendKind,
  usePrescriptionMarkers,
  useTrend,
} from "./useTrend";

const KINDS: readonly TrendKind[] = ["ketones", "weight"];

/**
 * Динамика кетонов и веса (раздел 9 ТЗ).
 *
 * Тот же график, что в кабинете, и по той же причине с вертикальными чертами
 * смены назначения: без них скачок показателя читается как ухудшение состояния,
 * хотя это следствие изменённой терапии.
 */
export function ChartsScreen({ session }: { session: Session }) {
  const { t } = useTranslation();
  const markers = usePrescriptionMarkers(session.patientId);

  return (
    <main className="flex flex-col gap-block p-block">
      <h1 className="text-page-title">{t("charts.title")}</h1>
      <p className="text-muted-foreground">
        {t("charts.period", { days: TREND_DAYS })}
      </p>

      {markers.isError && (
        // Молча остаться без черт нельзя — см. `usePrescriptionMarkers`.
        <WarningBanner
          level="warning"
          title={t("charts.markersUnavailableTitle")}
        >
          {t("charts.markersUnavailable")}
        </WarningBanner>
      )}

      {KINDS.map((kind) => (
        <Trend
          key={kind}
          patientId={session.patientId}
          kind={kind}
          markers={markers.data ?? []}
        />
      ))}
    </main>
  );
}

function Trend({
  patientId,
  kind,
  markers,
}: {
  patientId: string;
  kind: TrendKind;
  markers: ReturnType<typeof usePrescriptionMarkers>["data"] & object;
}) {
  const { t } = useTranslation();
  const trend = useTrend(patientId, kind);

  return (
    <Section title={t(`charts.${kind}.title`)} density="compact">
      <AsyncSection
        loading={trend.isPending}
        skeleton={null}
        error={
          trend.isError
            ? {
                title: t("charts.loadError"),
                description:
                  errorMessageOf(trend.error) ?? t("home.loadErrorHint"),
              }
            : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void trend.refetch()}
        isEmpty={false}
        empty={null}
      >
        <TrendChart
          points={trend.data ?? []}
          markers={markers}
          unit={t(`charts.${kind}.unit`)}
          caption={t(`charts.${kind}.caption`)}
          emptyState={t("charts.empty")}
          formatDate={formatChartDate}
        />
      </AsyncSection>
    </Section>
  );
}

/** День и месяц: год на графике за месяц — шум, а места на телефоне мало. */
function formatChartDate(value: Date): string {
  return value.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
}
