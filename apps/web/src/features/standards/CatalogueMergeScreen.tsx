import {
  AsyncSection,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Metric,
  MetricRow,
  Section,
  formatGrams,
  formatKcal,
  toast,
} from "@ketocare/ui";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Layers } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { SelectField } from "../../components/Field";
import { errorMessageOf } from "../../lib/api";
import { queryState } from "../../lib/queryState";
import { useAddressPatch, useAddressState } from "../../routes/useSectionTab";
import { TableSkeleton } from "../admin/TableSkeleton";
import { defaultSources } from "./mergeSources";
import {
  useApplyCatalogueMergeMutation,
  useCatalogueMergePreview,
  useFoodStandards,
  type CatalogueMergeField,
  type CatalogueMergeRow,
} from "./useFoodStandards";

/** Поля строки в порядке столбцов. */
const VALUE_COLUMNS = [
  "kcal_100g",
  "fat_100g",
  "protein_100g",
  "carbs_100g",
  "fiber_100g",
] as const;
type ValueColumn = (typeof VALUE_COLUMNS)[number];

/**
 * Экран сверки: сборка рабочего справочника клиники из справочников-источников
 * (ADR-0067, ADR-0068).
 *
 * Широкий экран, а не панель: это таблица на десятки строк с источником у
 * каждого числа (П56). Цель и порядок источников живут в адресе
 * (`?kind=merge&standard=&sources=`, П1): от порядка зависит каждое число, и
 * ссылка коллеге обязана показать то же превью. Отметки «подтверждаю» — нет:
 * это черновик решения до нажатия «Применить».
 */
export function CatalogueMergeScreen({ targetId }: { targetId: string }) {
  const { t } = useTranslation("products");
  const ids = useId();
  const address = useAddressState();
  const patchAddress = useAddressPatch();
  const standards = useFoodStandards();

  const all = useMemo(() => standards.data ?? [], [standards.data]);
  const target = all.find((standard) => standard.id === targetId);
  const references = useMemo(
    () => all.filter((standard) => standard.kind === "reference"),
    [all],
  );

  const fromAddress = (address.sources ?? "")
    .split(",")
    .filter((id) => references.some((standard) => standard.id === id));
  const sources =
    address.sources === undefined ? defaultSources(references) : fromAddress;
  const [first = "", second = ""] = sources;

  const setSources = (next: string[]) =>
    patchAddress({
      sources: next.filter(Boolean).join(",") || undefined,
    });

  return (
    <div className="flex flex-col gap-screen">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link
          to="."
          search={(previous: Record<string, unknown>) => ({
            ...previous,
            kind: undefined,
            standard: undefined,
            sources: undefined,
          })}
        >
          <ArrowLeft aria-hidden="true" />
          {t("merge.back")}
        </Link>
      </Button>

      <Section
        title={t("merge.title", { name: target?.name ?? "" })}
        description={t("merge.intro")}
      >
        <div className="flex flex-wrap gap-field">
          <SelectField
            id={`${ids}-first`}
            width="wide"
            label={t("merge.first")}
            hint={t("merge.firstHint")}
            value={first}
            onChange={(event) =>
              setSources([
                event.target.value,
                second === event.target.value ? "" : second,
              ])
            }
          >
            {references.map((standard) => (
              <option key={standard.id} value={standard.id}>
                {standard.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            id={`${ids}-second`}
            width="wide"
            label={t("merge.second")}
            hint={t("merge.secondHint")}
            optional
            value={second}
            onChange={(event) => setSources([first, event.target.value])}
          >
            <option value="">{t("merge.none")}</option>
            {references
              .filter((standard) => standard.id !== first)
              .map((standard) => (
                <option key={standard.id} value={standard.id}>
                  {standard.name}
                </option>
              ))}
          </SelectField>
        </div>
      </Section>

      {first === "" ? (
        <EmptyState icon={Layers} title={t("merge.noSources")} />
      ) : (
        <MergePreview
          // Новый порядок — новое превью: прежние отметки к нему не относятся.
          key={sources.join(",")}
          targetId={targetId}
          targetName={target?.name ?? ""}
          sourceIds={sources}
        />
      )}
    </div>
  );
}

function MergePreview({
  targetId,
  targetName,
  sourceIds,
}: {
  targetId: string;
  targetName: string;
  sourceIds: string[];
}) {
  const { t } = useTranslation("products");
  const preview = useCatalogueMergePreview(targetId, sourceIds);
  const apply = useApplyCatalogueMergeMutation(targetId);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());

  const rows = useMemo(() => preview.data?.rows ?? [], [preview.data]);
  const totals = preview.data?.totals;

  const toggle = (foodId: string, checked: boolean) =>
    setAccepted((previous) => {
      const next = new Set(previous);
      if (checked) next.add(foodId);
      else next.delete(foodId);
      return next;
    });

  const columns = useMemo<ColumnDef<CatalogueMergeRow, unknown>[]>(
    () => [
      {
        id: "accept",
        header: t("merge.columns.accept"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.status === "needs_review" ? (
            <Checkbox
              aria-label={t("merge.acceptRow", { name: row.original.name_ru })}
              checked={accepted.has(row.original.food_id)}
              onChange={(event) =>
                toggle(row.original.food_id, event.target.checked)
              }
            />
          ) : null,
      },
      {
        accessorKey: "name_ru",
        header: t("merge.columns.product"),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name_ru}</span>
        ),
      },
      ...VALUE_COLUMNS.map((name): ColumnDef<CatalogueMergeRow, unknown> => ({
        id: name,
        header: t(`merge.columns.${name}`),
        enableSorting: false,
        cell: ({ row }) => (
          <ValueCell name={name} field={row.original.fields[name]} />
        ),
      })),
      {
        accessorKey: "status",
        header: t("merge.columns.status"),
        cell: ({ row }) => <StatusCell row={row.original} />,
      },
    ],
    [t, accepted],
  );

  const failed = (error: unknown) =>
    toast.error(errorMessageOf(error) ?? t("common:errors.unexpected"));
  const willWrite = (totals?.written ?? 0) + accepted.size;
  // Строки «на проверку» диетолог подтверждает списком после просмотра: при
  // первой сборке их десятки, и сорок отдельных флажков подряд — лишняя работа.
  const reviewIds = (preview.data?.rows ?? [])
    .filter((row) => row.status === "needs_review")
    .map((row) => row.food_id);
  const allAccepted =
    reviewIds.length > 0 && reviewIds.every((id) => accepted.has(id));

  return (
    <Section
      title={t("merge.previewTitle")}
      description={t("merge.previewIntro")}
      action={
        <div className="flex flex-wrap items-center gap-field">
          {reviewIds.length > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={apply.isPending}
              onClick={() =>
                setAccepted(allAccepted ? new Set() : new Set(reviewIds))
              }
            >
              {allAccepted
                ? t("merge.acceptNone")
                : t("merge.acceptAll", { count: reviewIds.length })}
            </Button>
          )}
          <ConfirmDialog
            trigger={
              <Button
                type="button"
                disabled={!preview.data || apply.isPending || willWrite === 0}
              >
                {t("merge.apply")}
              </Button>
            }
            title={t("merge.confirm.title", { name: targetName })}
            description={t("merge.confirm.body")}
            confirmLabel={t("merge.apply")}
            cancelLabel={t("common:actions.cancel")}
            onConfirm={() =>
              apply.mutate(
                { sourceIds, accept: [...accepted] },
                {
                  onSuccess: (result) => {
                    setAccepted(new Set());
                    toast.success(
                      t("merge.applied", { count: result.totals.written }),
                    );
                  },
                  onError: failed,
                },
              )
            }
          />
        </div>
      }
    >
      <AsyncSection
        {...queryState(preview)}
        skeleton={<TableSkeleton label={t("merge.loading")} columns={6} />}
        error={
          preview.isError
            ? {
                title: t("merge.loadError"),
                description:
                  errorMessageOf(preview.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void preview.refetch()}
        isEmpty={rows.length === 0}
        empty={<EmptyState icon={Layers} title={t("merge.empty")} />}
      >
        {totals && (
          <MetricRow label={t("merge.totals.title")}>
            <Metric label={t("merge.status.new")} value={totals.new} />
            <Metric label={t("merge.status.update")} value={totals.update} />
            <Metric
              label={t("merge.status.unchanged")}
              value={totals.unchanged}
            />
            <Metric
              label={t("merge.status.needs_review")}
              value={totals.needs_review}
              emphasis={totals.needs_review > 0}
            />
            <Metric
              label={t("merge.status.conflict")}
              value={totals.conflict}
            />
            <Metric label={t("merge.status.no_data")} value={totals.no_data} />
          </MetricRow>
        )}
        <DataTable
          columns={columns}
          data={rows}
          caption={t("merge.caption", { name: targetName })}
          emptyState={null}
          pageSize={0}
          labels={{
            previousPage: t("common:actions.retry"),
            nextPage: t("common:actions.retry"),
            pageStatus: () => "",
          }}
        />
      </AsyncSection>
    </Section>
  );
}

function formatValue(name: ValueColumn, value: number): string {
  return name === "kcal_100g" ? formatKcal(value) : formatGrams(value);
}

function ValueCell({
  name,
  field,
}: {
  name: ValueColumn;
  field: CatalogueMergeField | undefined;
}) {
  const { t } = useTranslation("products");
  if (field === undefined) return null;

  let note: string;
  if (field.manual) {
    // Число без отслеженного источника защищено так же, как правка, но
    // называть его правкой — приписать человеку то, чего он не делал.
    const kept = field.untracked ? "kept" : "manual";
    note =
      field.conflict && field.merged != null
        ? t(`merge.note.${kept}Conflict`, {
            value: formatValue(name, field.merged),
          })
        : t(`merge.note.${kept}`);
  } else if (field.value == null) {
    note = "";
  } else if (field.source_standard_name == null) {
    note = t("merge.note.unknown");
  } else {
    note = field.net_plus_fiber
      ? t("merge.note.plusFiber", { name: field.source_standard_name })
      : field.source_standard_name;
  }

  return (
    <span className="flex flex-col leading-tight">
      <span className="tabular-nums">
        {field.value == null
          ? t("merge.noData")
          : formatValue(name, field.value)}
      </span>
      {note !== "" && (
        <span
          className={
            field.conflict
              ? "text-xs text-warning-strong"
              : "text-xs text-muted-foreground"
          }
        >
          {note}
        </span>
      )}
    </span>
  );
}

function StatusCell({ row }: { row: CatalogueMergeRow }) {
  const { t } = useTranslation("products");
  const attention =
    row.status === "needs_review" ||
    row.status === "conflict" ||
    row.status === "no_data";
  const missing = row.missing ?? [];

  return (
    <span className="flex flex-col items-start gap-1">
      <Badge variant={attention ? "outline" : "secondary"}>
        {t(`merge.status.${row.status}`)}
      </Badge>
      {(row.anomalies ?? []).map((code) => (
        <span key={code} className="text-xs text-muted-foreground">
          {t(`merge.anomaly.${code}`, { defaultValue: code })}
        </span>
      ))}
      {missing.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {t("merge.missing", {
            fields: missing
              .map((field) => t(`merge.field.${field}`))
              .join(", "),
          })}
        </span>
      )}
    </span>
  );
}
