import {
  Button,
  ConfirmDialog,
  DiaryEntryCard,
  EmptyState,
  Skeleton,
} from "@ketocare/ui";
import { NotebookPen } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { DiaryLog } from "./diaryApi";
import { formatChartDate } from "./time";

interface DiaryListProps {
  logs: DiaryLog[];
  /** Идентификатор текущего пользователя: свои записи можно править и удалять */
  currentUserId: string | null;
  seizureTypeNames: Map<string, string>;
  medicationNames: Map<string, string>;
  onEdit: (log: DiaryLog) => void;
  onDelete: (logId: string) => void;
  deletingId: string | null;
  /** Пустое состояние: готовый узел с действием либо просто текст */
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
  if (logs.length === 0) {
    // Экран, где добавлять нечего (карта врача), передаёт просто текст —
    // оформление пустого состояния всё равно остаётся общим.
    return typeof emptyState === "string" ? (
      <EmptyState icon={NotebookPen} title={emptyState} />
    ) : (
      <>{emptyState}</>
    );
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-block p-0">
      {logs.map((log) => (
        <li key={log.id}>
          <DiaryEntry
            log={log}
            own={log.created_by !== null && log.created_by === currentUserId}
            seizureTypeNames={seizureTypeNames}
            medicationNames={medicationNames}
            deleting={deletingId === log.id}
            onEdit={() => onEdit(log)}
            onDelete={() => onDelete(log.id)}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Загрузка списка — скелетон в форме будущих карточек.
 *
 * Подпись приходит снаружи: компонент общий для дневника семьи и карты врача,
 * а словари у них разные (правило 8 CLAUDE.md).
 */
export function DiaryListSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex flex-col gap-block"
      data-testid="diary-list-skeleton"
    >
      {[0, 1, 2].map((row) => (
        <div key={row} className="rounded-xl bg-card p-4 shadow-kc">
          <div className="flex items-baseline justify-between gap-block">
            <Skeleton className="h-5 w-40 max-w-[60%]" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="mt-3 h-4 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

interface DiaryEntryProps {
  log: DiaryLog;
  own: boolean;
  seizureTypeNames: Map<string, string>;
  medicationNames: Map<string, string>;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function DiaryEntry({
  log,
  own,
  seizureTypeNames,
  medicationNames,
  deleting,
  onEdit,
  onDelete,
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
  const occurredAt = new Date(log.occurred_at);

  return (
    <DiaryEntryCard
      title={title}
      occurredAt={occurredAt}
      source={log.source}
      actions={
        own ? (
          <EntryActions
            title={title}
            occurredAt={occurredAt}
            deleting={deleting}
            onEdit={onEdit}
            onDelete={onDelete}
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
  occurredAt,
  deleting,
  onEdit,
  onDelete,
}: {
  title: string;
  occurredAt: Date;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("diary");

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onEdit}
        aria-label={t("list.editAria", { title })}
      >
        {t("list.edit")}
      </Button>

      {/* Диалог кита, а не подмена кнопок на месте: заголовок называет запись,
          Esc и фокус работают одинаково во всём приложении (правило П14). */}
      <ConfirmDialog
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={deleting}
            aria-label={t("list.deleteAria", { title })}
            className="text-destructive hover:text-destructive"
          >
            {deleting ? t("list.deleting") : t("list.delete")}
          </Button>
        }
        title={t("list.confirmTitle", { date: formatChartDate(occurredAt) })}
        description={t("list.confirmBody", { title })}
        confirmLabel={t("list.confirmYes")}
        cancelLabel={t("list.confirmNo")}
        onConfirm={onDelete}
      />
    </>
  );
}
