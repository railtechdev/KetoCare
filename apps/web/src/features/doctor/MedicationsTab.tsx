import {
  AsyncSection,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Section,
  toast,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Pill, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { MedicationForm } from "./MedicationForm";
import { formatIsoDate } from "./dates";
import { useMedicationMutations } from "./doctorMutations";
import { useMedications } from "./doctorQueries";
import { TableSkeleton } from "./skeletons";
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
            onEdit={() => setForm({ mode: "edit", medication: row.original })}
            onConfirmDelete={() =>
              remove.mutate(row.original.id, {
                onSuccess: () =>
                  toast.success(
                    t("medications.deleted", {
                      name: row.original.drug_name,
                    }),
                  ),
              })
            }
          />
        ),
      },
    ];
  }, [canWrite, remove, t]);

  if (form !== null) {
    const editing = form.mode === "edit" ? form.medication : null;
    const mutation = editing === null ? create : update;

    return (
      <Section
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
              create.mutate(body, {
                onSuccess: () => {
                  toast.success(t("medications.created"));
                  setForm(null);
                },
              });
            } else {
              update.mutate(
                { medicationId: editing.id, body },
                {
                  onSuccess: () => {
                    toast.success(t("medications.updated"));
                    setForm(null);
                  },
                },
              );
            }
          }}
        />
      </Section>
    );
  }

  return (
    <Section title={t("medications.title")}>
      <AsyncSection
        loading={medications.isPending}
        skeleton={<TableSkeleton label={t("medications.loading")} rows={3} />}
        error={
          medications.isError
            ? {
                title: t("medications.loadError"),
                description:
                  errorMessageOf(medications.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void medications.refetch()}
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={Pill}
            title={t("medications.empty")}
            description={t("medications.emptyDescription")}
            action={
              canWrite ? (
                <Button
                  type="button"
                  onClick={() => setForm({ mode: "create" })}
                >
                  <Plus aria-hidden="true" />
                  {t("medications.add")}
                </Button>
              ) : undefined
            }
          />
        }
      >
        <DataTable
          columns={columns}
          data={items}
          caption={t("medications.caption")}
          emptyState={null}
          labels={{
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            pageStatus: (page, total) => t("table.pageStatus", { page, total }),
          }}
        />
      </AsyncSection>

      {/* Ошибка удаления — не ошибка загрузки: повторять нечего, врач решает
          заново. Поэтому она остаётся сообщением действия. */}
      {remove.isError && (
        <FormError>
          {errorMessageOf(remove.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {/* Условие прежнее — только роль. Добавленная проверка на непустой
          список отнимала возможность назначить препарат ровно тогда, когда
          список не загрузился. */}
      {canWrite && (
        <Button
          type="button"
          className="self-start"
          onClick={() => setForm({ mode: "create" })}
        >
          <Plus aria-hidden="true" />
          {t("medications.add")}
        </Button>
      )}
    </Section>
  );
}

function MedicationActions({
  medication,
  onEdit,
  onConfirmDelete,
}: {
  medication: Medication;
  onEdit: () => void;
  onConfirmDelete: () => void;
}) {
  const { t } = useTranslation("doctor");

  return (
    <div className="flex flex-wrap gap-field">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-touch"
        onClick={onEdit}
        aria-label={t("medications.editAria", { name: medication.drug_name })}
      >
        <Pencil aria-hidden="true" />
        {t("actions.edit")}
      </Button>

      {/* Удаление — только для ошибочной записи: отмена препарата задаётся
          датой окончания приёма, иначе исчезнет объяснение уже сделанных
          отметок о приёме. Подтверждение называет препарат (правило П14). */}
      <ConfirmDialog
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-touch text-destructive"
            aria-label={t("medications.deleteAria", {
              name: medication.drug_name,
            })}
          >
            <Trash2 aria-hidden="true" />
            {t("actions.delete")}
          </Button>
        }
        title={t("medications.confirmDeleteTitle", {
          name: medication.drug_name,
        })}
        description={t("medications.confirmDeleteBody")}
        confirmLabel={t("medications.confirmDeleteAction")}
        cancelLabel={t("actions.cancel")}
        onConfirm={onConfirmDelete}
      />
    </div>
  );
}
