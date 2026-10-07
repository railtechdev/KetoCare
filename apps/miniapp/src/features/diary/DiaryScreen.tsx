import {
  AsyncSection,
  Button,
  Section,
  StatusNote,
  TrendChart,
  WarningBanner,
  formatDayMonth,
} from "@ketocare/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import {
  TREND_DAYS,
  type TrendKind,
  usePrescriptionMarkers,
  useTrend,
} from "../charts/useTrend";
import type { Session } from "../session/useSession";
import { AddEntry } from "./AddEntry";
import { DiaryEntries } from "./DiaryEntries";
import { useDiaryEntries } from "./useDiary";

const KINDS: readonly TrendKind[] = ["ketones", "weight", "seizures"];

/**
 * «Дневник»: графики за месяц и записи за две недели (раздел 9 ТЗ, ADR-0044).
 *
 * Графики — те же, что в кабинете, и по той же причине с вертикальными чертами
 * смены назначения: без них скачок показателя читается как ухудшение состояния,
 * хотя это следствие изменённой терапии. Под ними — записи, которые семья
 * может исправить: прежде вкладка показывала только линии, и ошибочный замер,
 * видный на графике, было нечем убрать. Новую запись добавляет первичное
 * действие экрана (дополнение к ADR-0044 от 07.10.2026).
 */
export function DiaryScreen({ session }: { session: Session }) {
  const { t } = useTranslation();
  const markers = usePrescriptionMarkers(session.patientId);
  const [adding, setAdding] = useState(false);
  const entries = useDiaryEntries(session.patientId);
  // Оба запроса живут здесь, а не в блоках: без сети они встают на паузу
  // одновременно, и блок сказал бы «нет связи» дважды подряд — одна и та же
  // фраза в двух соседних строках (правило П27). Экран говорит это один раз.
  const trends: Record<TrendKind, ReturnType<typeof useTrend>> = {
    ketones: useTrend(session.patientId, "ketones"),
    weight: useTrend(session.patientId, "weight"),
    seizures: useTrend(session.patientId, "seizures"),
  };
  // Только пока показывать нечего: фоновое обновление тоже встаёт на паузу, а
  // «нет связи» над нарисованными графиками — сообщение о том, что и так видно.
  const waitingForNetwork =
    entries.isWaiting ||
    KINDS.some(
      (kind) => trends[kind].fetchStatus === "paused" && trends[kind].isPending,
    );

  return (
    <main className="flex flex-col gap-section p-section">
      <h1 className="text-page-title">{t("diary.title")}</h1>
      <p className="text-muted-foreground">
        {t("charts.period", { days: TREND_DAYS })}
      </p>
      {/* Первичное действие экрана — над графиками: записывают чаще, чем
          рассматривают линии, и кнопка внизу, под тридцатью днями графиков,
          оставалась бы за сгибом. */}
      <Button
        type="button"
        className="min-h-touch w-full"
        onClick={() => setAdding(true)}
      >
        <Plus aria-hidden="true" className="size-5" />
        {t("diary.add.action")}
      </Button>

      {markers.isError && (
        // Молча остаться без черт нельзя — см. `usePrescriptionMarkers`.
        <WarningBanner
          level="warning"
          title={t("charts.markersUnavailableTitle")}
        >
          {t("charts.markersUnavailable")}
        </WarningBanner>
      )}

      {waitingForNetwork && (
        <StatusNote>{t("errors.waitingForNetwork")}</StatusNote>
      )}

      {KINDS.map((kind) => (
        <Trend
          key={kind}
          trend={trends[kind]}
          kind={kind}
          markers={markers.data ?? []}
        />
      ))}

      <DiaryEntries session={session} onAdd={() => setAdding(true)} />

      {adding && (
        <AddEntry session={session} onClose={() => setAdding(false)} />
      )}
    </main>
  );
}

function Trend({
  trend,
  kind,
  markers,
}: {
  trend: ReturnType<typeof useTrend>;
  kind: TrendKind;
  markers: ReturnType<typeof usePrescriptionMarkers>["data"] & object;
}) {
  const { t } = useTranslation();

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
        // Пока ответа нет, блок молчит: у графика своё «записей нет», и на
        // паузе он утверждал бы, что записей за месяц не было, — при живых
        // записях и рядом со строкой «нет связи». Пустой ответ от пустого
        // ожидания отличает именно `undefined`.
        isEmpty={trend.data === undefined}
        empty={null}
      >
        <TrendChart
          points={trend.data ?? []}
          markers={markers}
          unit={t(`charts.${kind}.unit`)}
          caption={t(`charts.${kind}.caption`)}
          emptyState={
            kind === "seizures" ? t("charts.seizures.empty") : t("charts.empty")
          }
          formatDate={formatDayMonth}
        />
      </AsyncSection>
    </Section>
  );
}
