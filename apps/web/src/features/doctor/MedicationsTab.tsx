import { DataTable } from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { Panel } from "../home/Panel";
import { MedicationForm } from "./MedicationForm";
import { formatIsoDate } from "./dates";
import { useMedicationMutations } from "./doctorMutations";
import { useMedications } from "./doctorQueries";
import { isDoctor, type Medication } from "./types";

type FormState =
  { mode: "create" } | { mode: "edit"; medication: Medication } | null;

/** Схема лекарственной терапии пациента (раздел 8.3 ТЗ, карта пациента). */
export function MedicationsTab({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const { session } = useSession();

  const medications = useMedications(patientId);
  const { create, update, remove } = useMedicationMutations(patientId);

  const [form, setForm] = useState<FormState>(null);
  // Подтверждение удаления живёт на уровне вкладки: открытым может быть только
  // одно, иначе врач случайно снимает не тот препарат.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const canWrite = isDoctor(session?.role);
  const items = medications.data ?? [];

  const columns = useMemo<ColumnDef<Medication, unknown>[]>(() => {
    const base: ColumnDef<Medication, unknown>[] = [
      { accessorKey: "drug_name", header: t("medications.fields.drugName") },
      { accessorKey: "dose", header: t("medications.fields.dose") },
      { accessorKey: "frequency", header: t("medications.fields.frequency") },
      {
        accessorKey: "started_at",
        header: t("medications.fields.startedAt"),
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap">
            {formatIsoDate(row.original.started_at) ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "stopped_at",
        header: t("medications.fields.stoppedAt"),
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap">
            {row.original.stopped_at === null
              ? t("medications.ongoing")
              : (formatIsoDate(row.original.stopped_at) ?? "—")}
          </span>
        ),
      },
    ];

    if (!canWrite) return base;

    return [
      ...base,
      {
        id: "actions",
        header: t("medications.columns.actions"),
        enableSorting: false,
        cell: ({ row }) => (
          <MedicationActions
            medication={row.original}
            confirming={confirmId === row.original.id}
            deleting={remove.isPending && confirmId === row.original.id}
            onEdit={() => setForm({ mode: "edit", medication: row.original })}
            onAskDelete={() => setConfirmId(row.original.id)}
            onCancelDelete={() => setConfirmId(null)}
            onConfirmDelete={() =>
              remove.mutate(row.original.id, {
                onSuccess: () => setConfirmId(null),
              })
            }
          />
        ),
      },
    ];
  }, [canWrite, confirmId, remove, t]);

  if (form !== null) {
    const editing = form.mode === "edit" ? form.medication : null;
    const mutation = editing === null ? create : update;

    return (
      <Panel
        title={
          editing === null
            ? t("medications.createTitle")
            : t("medications.editTitle")
        }
      >
        <MedicationForm
          medication={editing}
          pending={mutation.isPending}
          error={mutation.error}
          onCancel={() => setForm(null)}
          onSubmit={(body) => {
            if (editing === null) {
              create.mutate(body, { onSuccess: () => setForm(null) });
            } else {
              update.mutate(
                { medicationId: editing.id, body },
                { onSuccess: () => setForm(null) },
              );
            }
          }}
        />
      </Panel>
    );
  }

  return (
    <Panel title={t("medications.title")}>
      {medications.isPending && (
        <p role="status" className="m-0 text-muted">
          {t("medications.loading")}
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

      {medications.data !== undefined && (
        <DataTable
          columns={columns}
          data={items}
          caption={t("medications.caption")}
          emptyState={t("medications.empty")}
          labels={{
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            pageStatus: (page, total) => t("table.pageStatus", { page, total }),
          }}
        />
      )}

      {canWrite && (
        <button
          type="button"
          onClick={() => setForm({ mode: "create" })}
          className="mt-4 min-h-touch rounded-lg bg-accent px-4 font-semibold text-on-accent"
        >
          {t("medications.add")}
        </button>
      )}
    </Panel>
  );
}

function MedicationActions({
  medication,
  confirming,
  deleting,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  medication: Medication;
  confirming: boolean;
  deleting: boolean;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const { t } = useTranslation("doctor");
  const action =
    "min-h-touch rounded-lg border border-line px-3 text-sm font-semibold";

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-danger" role="alert">
          {t("medications.confirmDelete")}
        </span>
        <button
          type="button"
          onClick={onConfirmDelete}
          disabled={deleting}
          className="min-h-touch rounded-lg bg-danger px-3 text-sm font-semibold text-on-danger disabled:opacity-60"
        >
          {t("actions.yes")}
        </button>
        <button type="button" onClick={onCancelDelete} className={action}>
          {t("actions.no")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onEdit}
        aria-label={t("medications.editAria", { name: medication.drug_name })}
        className={action}
      >
        {t("actions.edit")}
      </button>
      {/* Удаление — только для ошибочной записи: отмена препарата задаётся
          датой окончания приёма, иначе исчезнет объяснение уже сделанных
          отметок о приёме. */}
      <button
        type="button"
        onClick={onAskDelete}
        aria-label={t("medications.deleteAria", { name: medication.drug_name })}
        className={`${action} text-danger`}
      >
        {t("actions.delete")}
      </button>
    </div>
  );
}
