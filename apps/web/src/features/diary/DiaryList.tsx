import {
  Button,
  ConfirmDialog,
  DiaryEntryCard,
  EmptyState,
  Skeleton,
} from "@ketocare/ui";
import { NotebookPen } from "lucide-react";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { DiaryLog } from "./diaryApi";
import { formatChartDate } from "./time";

interface DiaryListProps {
  logs: DiaryLog[];
  /** Идентификатор текущего пользователя: свои записи можно править и удалять */
  currentUserId: string | null;
  seizureTypeNames: Map<string, string>;
  /** Названия интервалов длительности: приступ из бота хранит ссылку на шкалу */
  durationOptionNames: Map<string, string>;
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
  durationOptionNames,
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
            durationOptionNames={durationOptionNames}
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

/**
 * Строка длительности приступа — из того источника, который заполнен.
 *
 * Измеренная и со слов — разные величины, и показываются они по-разному:
 * «Длительность: 90 с» против «Длительность: от 10 до 30 минут». Пересчитать
 * интервал в секунды нельзя даже ради единообразия показа — получилось бы
 * число, неотличимое от засечённого секундомером (ADR-0020).
 */
function durationLine(
  entry: DiaryLog & { kind: "seizures" },
  optionNames: Map<string, string>,
  t: TFunction<"diary">,
): string | null {
  if (entry.duration_sec !== null) {
    return t("seizures.durationValue", { value: entry.duration_sec });
  }
  if (entry.duration_option_id !== null) {
    return t("seizures.durationInterval", {
      // Названия варианта может не оказаться, если справочник не загрузился.
      // Тогда честнее сказать «указана словами», чем не сказать ничего: врач
      // должен видеть, что ответ семьи есть.
      value:
        optionNames.get(entry.duration_option_id) ??
        t("seizures.durationUnnamed"),
    });
  }
  return null;
}

interface DiaryEntryProps {
  log: DiaryLog;
  own: boolean;
  seizureTypeNames: Map<string, string>;
  durationOptionNames: Map<string, string>;
  medicationNames: Map<string, string>;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function DiaryEntry({
  log,
  own,
  seizureTypeNames,
  durationOptionNames,
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
            // Длительность приходит одним из двух способов и никогда обоими:
            // измеренная — числом секунд, со слов семьи — вариантом шкалы
            // (ADR-0020). Интервал не пересчитывается в секунды даже для
            // показа: «10–30 минут», выведенные как «600 с», читались бы как
            // измерение.
            durationLine(entry, durationOptionNames, t),
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
