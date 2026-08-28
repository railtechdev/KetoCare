import { DiaryEntryCard } from "@ketocare/ui";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { DiaryLog } from "./diaryApi";

interface DiaryListProps {
  logs: DiaryLog[];
  /** Идентификатор текущего пользователя: свои записи можно править и удалять */
  currentUserId: string | null;
  seizureTypeNames: Map<string, string>;
  medicationNames: Map<string, string>;
  onEdit: (log: DiaryLog) => void;
  onDelete: (logId: string) => void;
  deletingId: string | null;
  emptyState: ReactNode;
}

/** Список записей дневника карточками дизайн-системы (раздел 8.2 ТЗ). */
export function DiaryList({
  logs,
  currentUserId,
  seizureTypeNames,
  medicationNames,
  onEdit,
  onDelete,
  deletingId,
  emptyState,
}: DiaryListProps) {
  // Подтверждение удаления живёт на уровне списка: открытым может быть только
  // одно, иначе родитель случайно удаляет не ту запись.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (logs.length === 0) {
    return <p className="m-0 text-muted-foreground">{emptyState}</p>;
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {logs.map((log) => (
        <li key={log.id}>
          <DiaryEntry
            log={log}
            own={log.created_by !== null && log.created_by === currentUserId}
            seizureTypeNames={seizureTypeNames}
            medicationNames={medicationNames}
            confirming={confirmId === log.id}
            deleting={deletingId === log.id}
            onEdit={() => onEdit(log)}
            onAskDelete={() => setConfirmId(log.id)}
            onCancelDelete={() => setConfirmId(null)}
            onConfirmDelete={() => {
              setConfirmId(null);
              onDelete(log.id);
            }}
          />
        </li>
      ))}
    </ul>
  );
}

interface DiaryEntryProps {
  log: DiaryLog;
  own: boolean;
  seizureTypeNames: Map<string, string>;
  medicationNames: Map<string, string>;
  confirming: boolean;
  deleting: boolean;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function DiaryEntry({
  log,
  own,
  seizureTypeNames,
  medicationNames,
  confirming,
  deleting,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: DiaryEntryProps) {
  const { t } = useTranslation("diary");

  function describe(entry: DiaryLog): {
    title: string;
    lines: (string | null)[];
  } {
    switch (entry.kind) {
      case "seizures":
        return {
          title:
            seizureTypeNames.get(entry.seizure_type_id) ??
            t("seizures.unknownType"),
          lines: [
            entry.duration_sec === null
              ? null
              : t("seizures.durationValue", { value: entry.duration_sec }),
            t("seizures.countValue", { value: entry.count }),
            entry.description,
            entry.triggers === null
              ? null
              : t("seizures.triggersValue", { value: entry.triggers }),
          ],
        };
      case "ketones":
        return {
          title: t("ketones.cardTitle", { value: entry.value }),
          lines: [
            t(
              entry.method === "blood"
                ? "ketones.methodBlood"
                : "ketones.methodUrine",
            ),
          ],
        };
      case "weight":
        return {
          title: t("weight.cardTitle", { value: entry.weight_kg }),
          lines: [
            entry.height_cm === null
              ? null
              : t("weight.heightValue", { value: entry.height_cm }),
          ],
        };
      case "medications":
        return {
          title:
            medicationNames.get(entry.medication_id) ??
            t("medications.unknownDrug"),
          lines: [
            t(entry.taken ? "medications.taken" : "medications.notTaken"),
          ],
        };
      case "meals":
        return {
          title: t("meals.cardTitle"),
          lines: [
            entry.free_text,
            entry.menu_item_id === null ? null : t("meals.fromMenu"),
          ],
        };
      case "side-effects":
        return { title: entry.symptom, lines: [entry.description] };
    }
  }

  const { title, lines } = describe(log);
  const details = lines.filter(
    (line): line is string => line !== null && line !== "",
  );

  return (
    <DiaryEntryCard
      title={title}
      occurredAt={new Date(log.occurred_at)}
      source={log.source}
      actions={
        own ? (
          <EntryActions
            title={title}
            confirming={confirming}
            deleting={deleting}
            onEdit={onEdit}
            onAskDelete={onAskDelete}
            onCancelDelete={onCancelDelete}
            onConfirmDelete={onConfirmDelete}
          />
        ) : undefined
      }
    >
      {details.length > 0 ? <Details lines={details} /> : undefined}
    </DiaryEntryCard>
  );
}

function Details({ lines }: { lines: string[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-foreground">
      {lines.map((line, index) => (
        <li key={`${index}-${line}`}>{line}</li>
      ))}
    </ul>
  );
}

function EntryActions({
  title,
  confirming,
  deleting,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  title: string;
  confirming: boolean;
  deleting: boolean;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const { t } = useTranslation("diary");

  const action = "rounded-lg border border-border px-3 text-sm font-semibold";

  if (confirming) {
    return (
      <>
        <span className="text-sm text-destructive" role="alert">
          {t("list.confirmDelete")}
        </span>
        <button
          type="button"
          onClick={onConfirmDelete}
          className="rounded-lg bg-destructive px-3 text-sm font-semibold text-destructive-foreground"
        >
          {t("list.confirmYes")}
        </button>
        <button type="button" onClick={onCancelDelete} className={action}>
          {t("list.confirmNo")}
        </button>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onEdit}
        aria-label={t("list.editAria", { title })}
        className={action}
      >
        {t("list.edit")}
      </button>
      <button
        type="button"
        onClick={onAskDelete}
        disabled={deleting}
        aria-label={t("list.deleteAria", { title })}
        className={`${action} text-destructive disabled:opacity-60`}
      >
        {deleting ? t("list.deleting") : t("list.delete")}
      </button>
    </>
  );
}
