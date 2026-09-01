import {
  AsyncSection,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FormSheet,
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
import { useAedDrugs, usePatientIntake } from "../intake/useIntake";
import { TableSkeleton } from "./skeletons";
import { isDoctor, type Medication } from "./types";

type FormState =
  | { mode: "create"; drugName?: string }
  | { mode: "edit"; medication: Medication }
  | null;

/** Схема лекарственной терапии пациента (раздел 8.3 ТЗ, карта пациента). */
export function MedicationsTab({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const { session } = useSession();

  const medications = useMedications(patientId);
  const { create, update, remove } = useMedicationMutations(patientId);

  const [form, setForm] = useState<FormState>(null);

  const canWrite = isDoctor(session?.role);
  const items = medications.data ?? [];

  // Препараты, названные семьёй в анкете и ещё не попавшие в схему.
  //
  // Семья перечисляет их при регистрации, а схему пишет врач — связи между
  // анкетой и `medications` не было никакой, и до первого приёма вкладка
  // дневника оставалась нерабочей. Автоматически схема не заводится: назначение
  // препарата — врачебное решение (правило «человек в контуре»).
  const intake = usePatientIntake(patientId);
  const drugs = useAedDrugs();
  const namedInIntake = (drugs.data ?? [])
    .filter((drug) => (intake.data?.current_aed_ids ?? []).includes(drug.id))
    .filter(
      (drug) =>
        !items.some(
          (medication) =>
            medication.drug_name.trim().toLocaleLowerCase("ru-RU") ===
            drug.name_ru.trim().toLocaleLowerCase("ru-RU"),
        ),
    );

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

  return (
    <Section
      title={t("medications.title")}
      density="compact"
      action={
        canWrite && (
          <Button type="button" onClick={() => setForm({ mode: "create" })}>
            <Plus aria-hidden="true" />
            {t("medications.add")}
          </Button>
        )
      }
    >
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

      {canWrite && namedInIntake.length > 0 && (
        <Section
          title={t("medications.fromIntake.title")}
          description={t("medications.fromIntake.description")}
          level={3}
          density="compact"
        >
          <ul className="m-0 flex list-none flex-wrap gap-field p-0">
            {namedInIntake.map((drug) => (
              <li key={drug.id}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setForm({ mode: "create", drugName: drug.name_ru })
                  }
                >
                  <Plus aria-hidden="true" />
                  {drug.name_ru}
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Ошибка удаления — не ошибка загрузки: повторять нечего, врач решает
          заново. Поэтому она остаётся сообщением действия. */}
      {remove.isError && (
        <FormError>
          {errorMessageOf(remove.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <MedicationFormSheet
        form={form}
        onClose={() => setForm(null)}
        create={create}
        update={update}
      />
    </Section>
  );
}

/**
 * Форма препарата — панелью, а не вместо вкладки (правило П32 канона).
 *
 * До этого `if (form !== null) return <Section><MedicationForm/></Section>`
 * подменял собой всю вкладку: врач, нажавший «Изменить» у третьей строки,
 * терял из виду схему терапии целиком и не мог свериться с тем, что правит.
 */
function MedicationFormSheet({
  form,
  onClose,
  create,
  update,
}: {
  form: FormState;
  onClose: () => void;
  create: ReturnType<typeof useMedicationMutations>["create"];
  update: ReturnType<typeof useMedicationMutations>["update"];
}) {
  const { t } = useTranslation("doctor");
  const editing = form?.mode === "edit" ? form.medication : null;
  const mutation = editing === null ? create : update;

  return (
    <FormSheet
      open={form !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        editing === null
          ? t("medications.createTitle")
          : t("medications.editTitle")
      }
    >
      <MedicationForm
        medication={editing}
        suggestedDrugName={form?.mode === "create" ? form.drugName : undefined}
        pending={mutation.isPending}
        error={mutation.error}
        onCancel={onClose}
        onSubmit={(body) => {
          if (editing === null) {
            create.mutate(body, {
              onSuccess: () => {
                toast.success(t("medications.created"));
                onClose();
              },
            });
          } else {
            update.mutate(
              { medicationId: editing.id, body },
              {
                onSuccess: () => {
                  toast.success(t("medications.updated"));
                  onClose();
                },
              },
            );
          }
        }}
      />
    </FormSheet>
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
