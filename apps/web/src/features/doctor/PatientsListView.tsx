import { DataTable, RatioBadge } from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { usePatients } from "../patients/usePatients";
import { PatientFlagsLegend, PatientFlagsView } from "./PatientFlagsView";
import { ageInMonths } from "./dates";
import { usePatientOverviews } from "./doctorQueries";
import { attentionRank, computePatientFlags, type PatientFlags } from "./flags";
import type { Patient } from "./types";
import { FIELD_CONTROL } from "../../components/Field";

interface PatientRow {
  patient: Patient;
  name: string;
  ageMonths: number | null;
  ratio: number | null;
  kcalPerDay: number | null;
  flags: PatientFlags | null;
  attention: number;
}

/** Список пациентов врача с флагами (раздел 8.3 ТЗ, «Врач / Пациенты»). */
export function PatientsListView({
  onOpen,
}: {
  onOpen: (patient: Patient) => void;
}) {
  const { t } = useTranslation("doctor");
  const [query, setQuery] = useState("");

  const patients = usePatients();
  const items = useMemo(() => patients.data?.items ?? [], [patients.data]);

  const overviews = usePatientOverviews(
    useMemo(() => items.map((patient) => patient.id), [items]),
  );

  // Отбор идёт по уже загруженному списку: ручка `/patients` отдаёт пациентов,
  // связанных с врачом, целиком, и повторный запрос на каждую букву ничего бы
  // не уточнил. Задержка всё равно нужна — она отделяет ввод от пересборки
  // таблицы вместе со всеми её ячейками.
  const debouncedQuery = useDebouncedValue(query, 200);
  const needle = debouncedQuery.trim().toLocaleLowerCase("ru-RU");

  const settled = !overviews.pending;

  const rows = useMemo<PatientRow[]>(() => {
    const now = new Date();

    return items
      .map((patient) => {
        const overview = overviews.byPatientId.get(patient.id) ?? null;
        const flags = computePatientFlags(overview);

        return {
          patient,
          name: patient.full_name,
          ageMonths: ageInMonths(patient.birth_date, now),
          ratio: overview?.prescription?.ratio ?? null,
          kcalPerDay: overview?.prescription?.kcal_per_day ?? null,
          flags,
          attention: attentionRank(flags),
        };
      })
      .filter(
        (row) =>
          needle === "" || row.name.toLocaleLowerCase("ru-RU").includes(needle),
      )
      .sort(
        (left, right) =>
          // Порядок по умолчанию — требующие внимания сверху: врач открывает
          // список, чтобы найти именно их, а не чтобы читать его целиком.
          //
          // Пока сводки грузятся, порядок алфавитный и не меняется с каждым
          // пришедшим ответом: строка, уезжающая из-под курсора, — это открытая
          // карта не того пациента. Перестановка происходит один раз, вместе с
          // появлением самих флагов.
          (settled ? right.attention - left.attention : 0) ||
          left.name.localeCompare(right.name, "ru-RU"),
      );
  }, [items, needle, overviews.byPatientId, settled]);

  const columns = useMemo<ColumnDef<PatientRow, unknown>[]>(
    () => [
      { accessorKey: "name", header: t("list.columns.name") },
      {
        accessorKey: "ageMonths",
        header: t("list.columns.age"),
        cell: ({ row }) => <AgeCell months={row.original.ageMonths} />,
      },
      {
        accessorKey: "ratio",
        header: t("list.columns.ratio"),
        cell: ({ row }) =>
          row.original.ratio === null ? (
            <span className="text-sm text-muted">
              {t("list.noPrescription")}
            </span>
          ) : (
            <RatioBadge ratio={row.original.ratio} />
          ),
      },
      {
        accessorKey: "kcalPerDay",
        header: t("list.columns.kcal"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.kcalPerDay === null
              ? "—"
              : t("list.kcalValue", { value: row.original.kcalPerDay })}
          </span>
        ),
      },
      {
        id: "flags",
        header: t("list.columns.flags"),
        enableSorting: false,
        cell: ({ row }) => <PatientFlagsView flags={row.original.flags} />,
      },
      {
        id: "open",
        header: t("list.columns.card"),
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => onOpen(row.original.patient)}
            aria-label={t("list.openAria", { name: row.original.name })}
            className="min-h-touch rounded-lg border border-line px-3 text-sm font-semibold text-accent"
          >
            {t("list.open")}
          </button>
        ),
      },
    ],
    [onOpen, t],
  );

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t("list.title")}</h1>
        <p className="mt-1 mb-0 text-muted">{t("list.intro")}</p>
      </header>

      <div className="max-w-md">
        <label
          className="mb-1.5 block text-sm font-medium"
          htmlFor="patient-search"
        >
          {t("list.search.label")}
        </label>
        <input
          id="patient-search"
          type="search"
          value={query}
          placeholder={t("list.search.placeholder")}
          onChange={(event) => setQuery(event.target.value)}
          className={FIELD_CONTROL}
        />
      </div>

      {patients.isError && (
        <FormError>
          {errorMessageOf(patients.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {patients.isPending ? (
        <p role="status" className="m-0 text-muted">
          {t("list.loading")}
        </p>
      ) : (
        <>
          {/* Флаги появляются по мере ответов на сводки: строка без сводки
              показывает прочерк, а не «данных нет» — это разные утверждения. */}
          {overviews.pending && (
            <p role="status" className="m-0 text-sm text-muted">
              {t("list.flagsLoading")}
            </p>
          )}
          {overviews.failed && (
            <p className="m-0 text-sm text-muted">{t("list.flagsFailed")}</p>
          )}

          <DataTable
            columns={columns}
            data={rows}
            caption={t("list.caption")}
            emptyState={needle === "" ? t("list.empty") : t("list.emptySearch")}
            labels={{
              previousPage: t("table.previousPage"),
              nextPage: t("table.nextPage"),
              pageStatus: (page, total) =>
                t("table.pageStatus", { page, total }),
            }}
          />

          <PatientFlagsLegend />
        </>
      )}
    </section>
  );
}

/**
 * Возраст в месяцах до двух лет и в годах дальше: до двух лет разница в месяцах
 * клинически значима, а «1 год» её стирает.
 */
function AgeCell({ months }: { months: number | null }) {
  const { t } = useTranslation("doctor");

  if (months === null) {
    return <span className="text-muted">—</span>;
  }

  return (
    <span className="tabular-nums whitespace-nowrap">
      {months < 24
        ? t("age.months", { count: months })
        : t("age.years", { count: Math.floor(months / 12) })}
    </span>
  );
}
