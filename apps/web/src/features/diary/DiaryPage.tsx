import {
  Button,
  EmptyState,
  AsyncSection,
  ErrorState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TrendChart,
  WarningBanner,
  toast,
  type PrescriptionMarker,
  type TrendPoint,
} from "@ketocare/ui";
import { useSearch } from "@tanstack/react-router";
import { NotebookPen } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { DiaryForm } from "./DiaryForm";
import { DiaryList, DiaryListSkeleton } from "./DiaryList";
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
  const search = useSearch({ from: "/app/$section" });

  // Вид берётся из адреса, если он там есть: быстрая кнопка главной открывает
  // нужную вкладку сразу, и родителю не нужно её искать. Дальше вкладка
  // переключается состоянием — адрес при этом не переписывается, чтобы кнопка
  // «назад» вела на предыдущий экран, а не на предыдущую вкладку.
  const requested = DIARY_KINDS.find((value) => value === search.kind);
  const [kind, setKind] = useState<DiaryKind>(requested ?? "seizures");

  return (
    <PageLayout title={t("title")} intro={t("intro")}>
      <Tabs value={kind} onValueChange={(value) => setKind(value as DiaryKind)}>
        {/* Видов шесть, а экран родителя проверяется на 360 px: список вкладок
            переносится по строкам вместо горизонтального скролла, а высота
            задаётся содержимым, иначе тач-цель не дотягивает до 44 px. */}
        <TabsList
          aria-label={t("tabsLabel")}
          className="h-auto! w-full flex-wrap justify-start"
        >
          {DIARY_KINDS.map((value) => (
            <TabsTrigger
              key={value}
              value={value}
              className="min-h-touch flex-none"
            >
              {t(`tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Radix монтирует только активную вкладку: запросы соседних видов
            записей не уходят, пока родитель их не открыл. */}
        {DIARY_KINDS.map((value) => (
          <TabsContent key={value} value={value} className="pt-block">
            <DiaryTab kind={value} patientId={patientId} />
          </TabsContent>
        ))}
      </Tabs>
    </PageLayout>
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
  const formRef = useRef<HTMLDivElement>(null);

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
      create.mutate(body, {
        onSuccess: () => {
          toast.success(t("form.saved"));
          onSaved();
        },
      });
      return;
    }
    update.mutate(
      { logId: editing.id, body },
      {
        onSuccess: () => {
          toast.success(t("form.updated"));
          setEditing(null);
          onSaved();
        },
      },
    );
  }

  /** Из пустого списка — сразу к форме: пустое состояние без выхода бесполезно. */
  function focusForm() {
    const node = formRef.current;
    if (node === null) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    node.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }

  return (
    <div className="flex flex-col gap-screen">
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
        <WarningBanner
          level="warning"
          title={t("chart.markersUnavailableTitle")}
        >
          {t("chart.markersUnavailable")}
        </WarningBanner>
      )}

      {medications.isError && (
        <ErrorState
          title={t("medications.errorTitle")}
          description={
            errorMessageOf(medications.error) ?? t("common:errors.unexpected")
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void medications.refetch()}
        />
      )}

      <div ref={formRef}>
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
      </div>

      {total > items.length && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("list.truncated", { shown: items.length, total })}
        </p>
      )}

      {/* Правило четырёх состояний — в AsyncSection: там же записано, почему
          ошибка не должна прятать уже показанные записи. */}
      <AsyncSection
        loading={logs.isLoading}
        skeleton={<DiaryListSkeleton label={t("list.loadingAria")} />}
        error={
          logs.isError
            ? {
                title: t("list.errorTitle"),
                description:
                  errorMessageOf(logs.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void logs.refetch()}
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={NotebookPen}
            title={t("list.emptyTitle")}
            description={t("list.emptyBody")}
            action={
              <Button type="button" onClick={focusForm}>
                {t("list.emptyAction")}
              </Button>
            }
          />
        }
      >
        {range !== null && (
          <DiaryList
            logs={items}
            currentUserId={session?.userId ?? null}
            seizureTypeNames={seizureTypeNames}
            medicationNames={medicationNames}
            onEdit={(log) => {
              // Ошибка добавления относится к прежней попытке — при переходе
              // к правке она снимается вместе с состоянием мутации.
              create.reset();
              setEditing(log);
            }}
            onDelete={(logId) =>
              remove.mutate(logId, {
                onSuccess: () => {
                  toast.success(t("list.deleted"));
                  if (editing?.id === logId) setEditing(null);
                },
                onError: (error) => {
                  toast.error(
                    errorMessageOf(error) ?? t("common:errors.unexpected"),
                  );
                },
              })
            }
            deletingId={remove.isPending ? (remove.variables ?? null) : null}
            emptyState={null}
          />
        )}
      </AsyncSection>
    </div>
  );
}
