import {
  Button,
  ConfirmDialog,
  DiaryEntryCard,
  EmptyState,
  Skeleton,
  Tiles,
  describeDiaryEntry,
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
    // Столько столбцов, сколько влезает. Записи дневника — независимые
    // карточки в одну-две строки текста: столбцом на мониторе 1920 каждая
    // растягивалась во всю ширину экрана, и «Кетоны 2.4 ммоль/л» занимало
    // строку в полтора метра. Порядок при этом остаётся хронологическим —
    // слева направо, потом вниз, как в любой сетке.
    <Tiles as="ul" columns="fill">
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
    </Tiles>
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
    // Скелетон повторяет раскладку списка тем же примитивом, а не своими
    // классами: пока классы были свои, они однажды разошлись бы, и экран
    // прыгал бы ровно в тот момент, ради которого скелетон и существует.
    <Tiles
      columns="fill"
      role="status"
      aria-label={label}
      data-testid="diary-list-skeleton"
    >
      {[0, 1, 2].map((row) => (
        <div key={row} className="rounded-xl bg-card p-4 shadow-kc">
          <div className="flex items-baseline justify-between gap-section">
            <Skeleton className="h-5 w-40 max-w-[60%]" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="mt-3 h-4 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/2" />
        </div>
      ))}
    </Tiles>
  );
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

  // Описание записи — из кита, общее с Mini App: какой источник
  // длительности приступа показывать (ADR-0020), решается одним местом.
  // Слова — свои, из словаря кабинета (`entry.*`).
  const { title, lines: details } = describeDiaryEntry(
    log,
    {
      seizureTypes: seizureTypeNames,
      durationOptions: durationOptionNames,
      medications: medicationNames,
    },
    (key, values) => t(key as "entry.meal", values),
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
