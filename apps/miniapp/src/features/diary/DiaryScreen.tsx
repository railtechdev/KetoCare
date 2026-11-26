import {
  AsyncSection,
  Button,
  SegmentedControl,
  Section,
  TrendChart,
  WarningBanner,
  formatDayMonth,
} from "@ketocare/ui";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import type { ScreenRequest } from "../../lib/tabs";
import {
  TREND_DAYS,
  type TrendKind,
  usePrescriptionMarkers,
  useTrend,
} from "../charts/useTrend";
import type { Session } from "../session/useSession";
import { AddEntry } from "./AddEntry";
import { DiaryEntries } from "./DiaryEntries";
import type { CreatableKind } from "./useDiary";

const KINDS: readonly TrendKind[] = ["ketones", "weight", "seizures"];

/** Что показывает вкладка: ленту записей или график. */
type DiaryView = "entries" | "chart";

/** Что открыть: выбор вида записи или сразу форму вида. */
type Adding = { kind?: CreatableKind } | null;

/**
 * «Дневник»: записи за две недели и график за месяц (раздел 9 ТЗ, ADR-0044,
 * ADR-0075).
 *
 * **Записи — первыми.** Прежде над ними стояли три графика по 260 px, и до
 * своей вчерашней записи человек листал два экрана. График один, с
 * переключателем «кетоны / вес / приступы».
 *
 * **«Записи / График» — переключатель наверху** (аудит Mini App 21.11.2026,
 * Д1). Под лентой за две недели график оказывался на восемнадцатом экране, и
 * до него не долистывали. Выбор помнится, пока вкладка открыта; лента при
 * этом остаётся смонтированной — раскрытые дни и отбор не теряются.
 *
 * Вертикальные черты смены назначения на графике остаются: без них скачок
 * показателя читается как ухудшение, хотя это следствие изменённой терапии.
 */
export function DiaryScreen({
  session,
  request = null,
}: {
  session: Session;
  /** Открыть форму записи — из «Сегодня» или кнопкой под напоминанием бота. */
  request?: ScreenRequest<{ addKind?: CreatableKind }> | null;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState<Adding>(
    request?.target.addKind !== undefined
      ? { kind: request.target.addKind }
      : null,
  );
  const [chart, setChart] = useState<TrendKind>("ketones");
  const [view, setView] = useState<DiaryView>("entries");
  const [handled, setHandled] = useState(request?.id ?? null);

  // Новый запрос к уже открытой вкладке (вторая кнопка под напоминанием).
  useEffect(() => {
    if (request === null || request.id === handled) return;
    setHandled(request.id);
    if (request.target.addKind !== undefined) {
      setAdding({ kind: request.target.addKind });
    }
  }, [request, handled]);

  return (
    <main className="flex flex-col gap-section p-section">
      <h1 className="text-page-title">{t("diary.title")}</h1>
      {/* Первичное действие экрана — во всю ширину и первым. */}
      <Button
        type="button"
        className="min-h-touch w-full"
        onClick={() => setAdding({})}
      >
        <Plus aria-hidden="true" className="size-5" />
        {t("diary.add.action")}
      </Button>

      <SegmentedControl
        label={t("diary.view.label")}
        value={view}
        onChange={setView}
        items={[
          { value: "entries", label: t("diary.view.entries") },
          { value: "chart", label: t("diary.view.chart") },
        ]}
        className="w-full [&>label]:flex-1"
      />

      <div hidden={view !== "entries"}>
        <DiaryEntries session={session} onAdd={() => setAdding({})} />
      </div>

      {view === "chart" && (
        <Trends patientId={session.patientId} kind={chart} onKind={setChart} />
      )}

      {adding !== null && (
        <AddEntry
          // Другой вид — другая форма: значения прежней не переезжают.
          key={adding.kind ?? "chooser"}
          session={session}
          initialKind={adding.kind}
          onClose={() => setAdding(null)}
        />
      )}
    </main>
  );
}

/** Один график с переключателем вида, за {@link TREND_DAYS} дней. */
function Trends({
  patientId,
  kind,
  onKind,
}: {
  patientId: string;
  kind: TrendKind;
  onKind: (kind: TrendKind) => void;
}) {
  const { t } = useTranslation();
  const markers = usePrescriptionMarkers(patientId);
  // Запрашивается только показанный вид: два других ждут переключения.
  const trend = useTrend(patientId, kind);

  return (
    <Section title={t("charts.title", { days: TREND_DAYS })} density="compact">
      <SegmentedControl
        label={t("charts.kind")}
        value={kind}
        onChange={onKind}
        items={KINDS.map((value) => ({
          value,
          label: t(`charts.${value}.title`),
        }))}
        className="w-full [&>label]:flex-1"
      />

      {markers.isError && (
        // Молча остаться без черт нельзя — см. `usePrescriptionMarkers`.
        <WarningBanner
          level="warning"
          title={t("charts.markersUnavailableTitle")}
        >
          {t("charts.markersUnavailable")}
        </WarningBanner>
      )}

      {/* Без сети график говорит об этом сам: лента записей в виде
          «График» скрыта, и её строка «нет связи» не видна. Оба вида разом
          не показываются, поэтому фраза одна на экране (правило П27). */}
      <AsyncSection
        loading={trend.isPending}
        skeleton={null}
        waiting={
          trend.fetchStatus === "paused" && trend.isPending
            ? t("errors.waitingForNetwork")
            : null
        }
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
        // Пока ответа нет, блок молчит: у графика своё «записей нет», и на
        // паузе он утверждал бы, что записей за месяц не было.
        isEmpty={trend.data === undefined}
        empty={null}
      >
        {(trend.data?.otherMethodCount ?? 0) > 0 && (
          <p className="m-0 text-sm text-muted-foreground">
            {t(
              trend.data?.ketoneMethod === "urine"
                ? "charts.ketones.bloodHidden"
                : "charts.ketones.urineHidden",
              { count: trend.data?.otherMethodCount ?? 0 },
            )}
          </p>
        )}
        <TrendChart
          points={trend.data?.points ?? []}
          markers={markers.data ?? []}
          unit={t(`charts.${kind}.unit`)}
          caption={
            kind === "ketones" && trend.data?.ketoneMethod != null
              ? t(`charts.ketones.caption_${trend.data.ketoneMethod}`, {
                  days: TREND_DAYS,
                })
              : t(`charts.${kind}.caption`, { days: TREND_DAYS })
          }
          emptyState={
            kind === "seizures"
              ? t("charts.seizures.empty", { days: TREND_DAYS })
              : t("charts.empty")
          }
          formatDate={formatDayMonth}
        />
      </AsyncSection>
    </Section>
  );
}
