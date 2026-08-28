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
import { useSession } from "../auth/useSession";
import { DiaryForm } from "./DiaryForm";
import { DiaryList } from "./DiaryList";
import { PeriodPicker } from "./PeriodPicker";
import {
  CHART_KINDS,
  DIARY_KINDS,
  type DiaryBody,
  type DiaryKind,
  type DiaryLog,
} from "./diaryApi";
import {
  customRange,
  formatChartDate,
  presetRange,
  toDateInput,
  type PeriodPreset,
} from "./time";
import {
  useDiaryLogs,
  useDiaryMutations,
  usePatientMedications,
  usePrescriptionVersions,
  useSeizureTypes,
} from "./useDiary";

/**
 * Дневники семьи (раздел 8.3 ТЗ).
 *
 * Вкладка на каждый из шести видов записей; период выбирается неделей, месяцем
 * или произвольно; кетоны и вес дополнительно показываются графиком с маркерами
 * смены назначения. Свои записи можно изменить и мягко удалить.
 */
export function DiaryPage({ patientId }: { patientId: string }) {
  const { t } = useTranslation("diary");
  const [kind, setKind] = useState<DiaryKind>("seizures");

  return (
    <section className="flex flex-col gap-6">
      <h1 className="m-0 text-xl font-semibold">{t("title")}</h1>

      <Tabs.Root
        value={kind}
        onValueChange={(value) => setKind(value as DiaryKind)}
      >
        <Tabs.List
          aria-label={t("tabsLabel")}
          className="flex flex-wrap gap-2 border-b border-border"
        >
          {DIARY_KINDS.map((value) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="min-h-touch px-4 text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold"
            >
              {t(`tabs.${value}`)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Radix монтирует только активную вкладку: запросы соседних видов
            записей не уходят, пока родитель их не открыл. */}
        {DIARY_KINDS.map((value) => (
          <Tabs.Content key={value} value={value} className="pt-4">
            <DiaryTab kind={value} patientId={patientId} />
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </section>
  );
}

function DiaryTab({ kind, patientId }: { kind: DiaryKind; patientId: string }) {
  const { t } = useTranslation("diary");
  const { session } = useSession();

  const [preset, setPreset] = useState<PeriodPreset>("week");
  const [fromInput, setFromInput] = useState(() =>
    toDateInput(new Date(presetRange("week", new Date()).from)),
  );
  const [toInput, setToInput] = useState(() => toDateInput(new Date()));
  const [editing, setEditing] = useState<DiaryLog | null>(null);

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
  const { create, update, remove } = useDiaryMutations(patientId, kind);
  const prescriptions = usePrescriptionVersions(patientId, withChart);
  const medications = usePatientMedications(patientId, kind === "medications");
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
        label: t("chart.marker", { version: version.version }),
      }));
  }, [prescriptions.data, range, t]);

  const seizureTypeNames = useMemo(
    () =>
      new Map((seizureTypes.data ?? []).map((type) => [type.id, type.name])),
    [seizureTypes.data],
  );

  const medicationOptions = useMemo(
    () => medications.data ?? [],
    [medications.data],
  );

  const medicationNames = useMemo(
    () =>
      new Map(
        medicationOptions.map((medication) => [
          medication.id,
          t("medications.option", {
            name: medication.drugName,
            dose: medication.dose,
          }),
        ]),
      ),
    [medicationOptions, t],
  );

  const saving = editing === null ? create : update;

  function submit(body: DiaryBody, onSaved: () => void) {
    if (editing === null) {
      create.mutate(body, { onSuccess: onSaved });
      return;
    }
    update.mutate(
      { logId: editing.id, body },
      {
        onSuccess: () => {
          setEditing(null);
          onSaved();
        },
      },
    );
  }

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
            kind === "ketones" ? "chart.unitKetones" : "chart.unitWeight",
          )}
          caption={t(
            kind === "ketones" ? "chart.ketonesCaption" : "chart.weightCaption",
          )}
          emptyState={t("chart.empty")}
          formatDate={formatChartDate}
        />
      )}

      {/* Молча остаться без маркеров нельзя: скачок показателя после смены
          назначения без вертикальной черты читается как ухудшение состояния. */}
      {withChart && prescriptions.isError && (
        <p className="m-0 text-sm text-warning">
          {t("chart.markersUnavailable")}
        </p>
      )}

      <DiaryForm
        key={editing?.id ?? "new"}
        kind={kind}
        editing={editing}
        seizureTypes={seizureTypes.data ?? []}
        medications={medicationOptions}
        onSubmit={submit}
        onCancel={() => setEditing(null)}
        pending={saving.isPending}
        error={saving.error}
      />

      {editing === null && create.isSuccess && (
        <p role="status" className="m-0 text-success">
          {t("form.saved")}
        </p>
      )}

      {medications.isError && (
        <FormError>
          {errorMessageOf(medications.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {remove.isError && (
        <FormError>
          {errorMessageOf(remove.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {logs.isError && (
        <FormError>
          {errorMessageOf(logs.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {total > items.length && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("list.truncated", { shown: items.length, total })}
        </p>
      )}

      {logs.isLoading ? (
        <p role="status" className="m-0 text-muted-foreground">
          {t("list.loading")}
        </p>
      ) : (
        range !== null && (
          <DiaryList
            logs={items}
            currentUserId={session?.userId ?? null}
            seizureTypeNames={seizureTypeNames}
            medicationNames={medicationNames}
            onEdit={(log) => {
              // «Запись сохранена» относится к добавлению — при переходе к
              // правке сообщение снимается вместе со состоянием мутации.
              create.reset();
              setEditing(log);
            }}
            onDelete={(logId) =>
              remove.mutate(logId, {
                onSuccess: () => {
                  if (editing?.id === logId) setEditing(null);
                },
              })
            }
            deletingId={remove.isPending ? (remove.variables ?? null) : null}
            emptyState={t("list.empty")}
          />
        )
      )}
    </div>
  );
}
