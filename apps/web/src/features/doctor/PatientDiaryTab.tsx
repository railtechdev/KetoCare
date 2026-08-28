import * as Tabs from "@radix-ui/react-tabs";
import {
  TrendChart,
  type PrescriptionMarker,
  type TrendPoint,
} from "@ketocare/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { DiaryList } from "../diary/DiaryList";
import { PeriodPicker } from "../diary/PeriodPicker";
import { CHART_KINDS, DIARY_KINDS, type DiaryKind } from "../diary/diaryApi";
import {
  customRange,
  formatChartDate,
  presetRange,
  toDateInput,
  type PeriodPreset,
} from "../diary/time";
import {
  useDiaryLogs,
  usePrescriptionVersions,
  useSeizureTypes,
} from "../diary/useDiary";
import { useMedications } from "./doctorQueries";

/**
 * Дневники пациента глазами врача (раздел 8.1 ТЗ, карта пациента).
 *
 * Список, выбор периода и график берутся у экрана дневников семьи целиком:
 * вторая реализация тех же карточек разошлась бы с первой, и одна и та же
 * запись выглядела бы у врача и у родителя по-разному.
 *
 * Записи только читаются: правка и мягкое удаление принадлежат автору записи,
 * то есть семье. `DiaryList` показывает действия лишь автору, поэтому
 * `currentUserId` здесь намеренно null.
 */
export function PatientDiaryTab({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const [kind, setKind] = useState<DiaryKind>("seizures");

  return (
    <Tabs.Root
      value={kind}
      onValueChange={(value) => setKind(value as DiaryKind)}
    >
      <Tabs.List
        aria-label={t("diary.tabsLabel")}
        className="flex flex-wrap gap-2 border-b border-border"
      >
        {DIARY_KINDS.map((value) => (
          <Tabs.Trigger
            key={value}
            value={value}
            className="min-h-touch px-4 text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold"
          >
            {t(`diary.kinds.${value}`)}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {/* Radix монтирует только активную вкладку: запросы соседних видов
          записей не уходят, пока врач их не открыл. */}
      {DIARY_KINDS.map((value) => (
        <Tabs.Content key={value} value={value} className="pt-4">
          <DiaryKindView kind={value} patientId={patientId} />
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

const noop = () => undefined;

function DiaryKindView({
  kind,
  patientId,
}: {
  kind: DiaryKind;
  patientId: string;
}) {
  const { t } = useTranslation("doctor");

  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [fromInput, setFromInput] = useState(() =>
    toDateInput(new Date(presetRange("month", new Date()).from)),
  );
  const [toInput, setToInput] = useState(() => toDateInput(new Date()));

  // Границы периода считаются один раз на выбор: пересчёт на каждый рендер менял
  // бы ключ запроса (в нём есть «сейчас») и гонял бы список по кругу.
  const range = useMemo(
    () =>
      preset === "custom"
        ? customRange(fromInput, toInput)
        : presetRange(preset, new Date()),
    [preset, fromInput, toInput],
  );

  const withChart = CHART_KINDS.includes(kind);

  const logs = useDiaryLogs(patientId, kind, range);
  const prescriptions = usePrescriptionVersions(patientId, withChart);
  // Названия препаратов нужны только вкладке отметок о приёме: на остальных
  // видах записей запрос не уходит.
  const medications = useMedications(patientId, kind === "medications");
  const seizureTypes = useSeizureTypes(kind === "seizures");

  const items = useMemo(() => logs.data?.items ?? [], [logs.data]);
  const total = logs.data?.total ?? 0;

  const points = useMemo<TrendPoint[]>(
    () =>
      items.flatMap((log) => {
        if (log.kind === "ketones") {
          return [{ at: new Date(log.occurred_at), value: log.value }];
        }
        if (log.kind === "weight") {
          return [{ at: new Date(log.occurred_at), value: log.weight_kg }];
        }
        return [];
      }),
    [items],
  );

  const markers = useMemo<PrescriptionMarker[]>(() => {
    if (range === null) return [];
    const from = new Date(range.from);
    const to = new Date(range.to);

    return (prescriptions.data ?? [])
      .filter(
        (version) =>
          version.effectiveFrom >= from && version.effectiveFrom <= to,
      )
      .map((version) => ({
        at: version.effectiveFrom,
        label: t("diary.marker", { version: version.version }),
      }));
  }, [prescriptions.data, range, t]);

  const seizureTypeNames = useMemo(
    () =>
      new Map((seizureTypes.data ?? []).map((type) => [type.id, type.name])),
    [seizureTypes.data],
  );

  const medicationNames = useMemo(
    () =>
      new Map(
        (medications.data ?? []).map((medication) => [
          medication.id,
          t("diary.medicationOption", {
            name: medication.drug_name,
            dose: medication.dose,
          }),
        ]),
      ),
    [medications.data, t],
  );

  return (
    <div className="flex flex-col gap-5">
      <PeriodPicker
        preset={preset}
        onPresetChange={setPreset}
        from={fromInput}
        to={toInput}
        onFromChange={setFromInput}
        onToChange={setToInput}
        invalid={preset === "custom" && range === null}
      />

      {withChart && (
        <TrendChart
          points={points}
          markers={markers}
          unit={t(
            kind === "ketones" ? "diary.unitKetones" : "diary.unitWeight",
          )}
          caption={t(
            kind === "ketones" ? "diary.ketonesCaption" : "diary.weightCaption",
          )}
          emptyState={t("diary.chartEmpty")}
          formatDate={formatChartDate}
        />
      )}

      {/* Молча остаться без маркеров нельзя: скачок показателя после смены
          назначения без вертикальной черты читается как ухудшение состояния. */}
      {withChart && prescriptions.isError && (
        <p className="m-0 text-sm text-warning">
          {t("diary.markersUnavailable")}
        </p>
      )}

      {logs.isError && (
        <FormError>
          {errorMessageOf(logs.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {total > items.length && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("diary.truncated", { shown: items.length, total })}
        </p>
      )}

      {logs.isLoading ? (
        <p role="status" className="m-0 text-muted-foreground">
          {t("diary.loading")}
        </p>
      ) : (
        range !== null && (
          <DiaryList
            logs={items}
            currentUserId={null}
            seizureTypeNames={seizureTypeNames}
            medicationNames={medicationNames}
            onEdit={noop}
            onDelete={noop}
            deletingId={null}
            emptyState={t("diary.empty")}
          />
        )
      )}
    </div>
  );
}
