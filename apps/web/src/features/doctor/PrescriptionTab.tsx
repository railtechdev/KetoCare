import {
  DataTable,
  EmptyState,
  ErrorState,
  RatioBadge,
  Section,
  toast,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { PrescriptionForm } from "./PrescriptionForm";
import { formatIsoDate, formatTimestamp } from "./dates";
import { useCreatePrescription } from "./doctorMutations";
import { activePrescriptionOf, usePrescriptionHistory } from "./doctorQueries";
import {
  prescriptionFormValues,
  toPrescriptionBody,
} from "./prescriptionSchema";
import { TableSkeleton } from "./skeletons";
import { canWritePrescriptions, type PrescriptionVersion } from "./types";

/**
 * Вкладка назначения: новая версия и история версий (раздел 8.3 ТЗ).
 *
 * Назначения append-only: правки существующей версии нет ни на сервере, ни здесь
 * — изменение назначения создаёт новую строку (правило 4 CLAUDE.md).
 */
export function PrescriptionTab({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const { session } = useSession();

  const history = usePrescriptionHistory(patientId);
  const create = useCreatePrescription(patientId);

  // Идентификатор созданной версии, а не её номер: номер берётся из
  // обновлённой истории, иначе пришлось бы считать «было плюс один», а пока
  // врач заполнял форму, версию мог создать коллега.
  const [createdId, setCreatedId] = useState<string | null>(null);

  const versions = useMemo(() => history.data?.versions ?? [], [history.data]);
  const active = activePrescriptionOf(history.data);
  const savedVersion =
    createdId === null
      ? null
      : (versions.find((entry) => entry.prescription.id === createdId)
          ?.version ?? null);

  // Успех — тост, а не зелёная плашка в потоке страницы (правило П16 канона).
  // Ждём номер версии из обновлённой истории: он и есть содержание сообщения.
  useEffect(() => {
    if (savedVersion === null) return;

    toast.success(t("prescription.saved.title", { version: savedVersion }), {
      description: t("prescription.saved.body"),
    });
    setCreatedId(null);
  }, [savedVersion, t]);

  const canWrite = canWritePrescriptions(session?.role);

  const columns = useMemo<ColumnDef<PrescriptionVersion, unknown>[]>(
    () => [
      {
        accessorKey: "version",
        header: t("prescription.columns.version"),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.version}</span>
        ),
      },
      {
        id: "effectiveFrom",
        accessorFn: (row) => row.prescription.effective_from,
        header: t("prescription.columns.effectiveFrom"),
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap">
            {formatIsoDate(row.original.prescription.effective_from) ?? "—"}
          </span>
        ),
      },
      {
        id: "ratio",
        accessorFn: (row) => row.prescription.ratio,
        header: t("fields.ratio"),
        cell: ({ row }) => (
          <RatioBadge ratio={row.original.prescription.ratio} />
        ),
      },
      {
        id: "kcal",
        accessorFn: (row) => row.prescription.kcal_per_day,
        header: t("fields.kcal"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.prescription.kcal_per_day}
          </span>
        ),
      },
      {
        id: "protein",
        accessorFn: (row) => row.prescription.protein_g,
        header: t("fields.protein"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.prescription.protein_g}
          </span>
        ),
      },
      {
        id: "carbsLimit",
        accessorFn: (row) => row.prescription.carbs_limit_g,
        header: t("fields.carbsLimit"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.prescription.carbs_limit_g}
          </span>
        ),
      },
      {
        id: "meals",
        accessorFn: (row) => row.prescription.meals_per_day,
        header: t("fields.meals"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.prescription.meals_per_day}
          </span>
        ),
      },
      {
        id: "createdAt",
        accessorFn: (row) => row.prescription.created_at,
        header: t("prescription.columns.createdAt"),
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap">
            {formatTimestamp(row.original.prescription.created_at) ?? "—"}
          </span>
        ),
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-block">
      {canWrite && (
        <Section
          title={t("prescription.formTitle")}
          description={t("prescription.formHint")}
        >
          <PrescriptionForm
            // Ключ по идентификатору действующей версии: после сохранения форма
            // пересоздаётся уже с новыми значениями, иначе врач увидел бы в ней
            // предыдущее назначение.
            key={active?.id ?? "first"}
            defaultValues={prescriptionFormValues(active, new Date())}
            pending={create.isPending}
            error={create.error}
            onSubmit={(values) =>
              create.mutate(toPrescriptionBody(values), {
                onSuccess: (created) => setCreatedId(created.id),
              })
            }
          />
        </Section>
      )}

      <Section title={t("prescription.historyTitle")}>
        {history.isPending && (
          <TableSkeleton label={t("prescription.loading")} rows={3} />
        )}

        {history.isError && (
          <ErrorState
            title={t("prescription.loadError")}
            description={
              errorMessageOf(history.error) ?? t("common:errors.unexpected")
            }
            retryLabel={t("common:actions.retry")}
            onRetry={() => void history.refetch()}
          />
        )}

        {history.data !== undefined && (
          <DataTable
            columns={columns}
            data={versions}
            caption={t("prescription.caption")}
            emptyState={
              <EmptyState
                icon={ClipboardList}
                title={t("prescription.empty")}
                description={t("prescription.emptyDescription")}
              />
            }
            labels={{
              previousPage: t("table.previousPage"),
              nextPage: t("table.nextPage"),
              pageStatus: (page, total) =>
                t("table.pageStatus", { page, total }),
            }}
          />
        )}
      </Section>
    </div>
  );
}
