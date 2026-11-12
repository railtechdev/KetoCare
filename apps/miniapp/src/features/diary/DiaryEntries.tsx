import {
  AsyncSection,
  Button,
  DiaryEntryCard,
  EmptyState,
  describeDiaryEntry,
  type DiaryEntryDescription,
  type DiaryEntryNames,
  Section,
  formatLocale,
  formatOccurredAt,
  toast,
} from "@ketocare/ui";
import { NotebookPen } from "lucide-react";
import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { RemoveButton } from "../../components/RemoveButton";
import { TelegramConfirmDialog } from "../../components/TelegramConfirmDialog";

import { errorMessageOf } from "../../lib/api";
import { useFamily } from "../family/useFamily";
import type { Session } from "../session/useSession";
import { EntryEditSheet } from "./EntryEditSheet";
import { KIND_ICON } from "./kinds";
import {
  DIARY_DAYS,
  type DiaryLog,
  useDiaryEntries,
  useDurationOptions,
  useEntryMutations,
  useMedications,
  useSeizureTypes,
} from "./useDiary";

/** Описание записи — кит, общий с кабинетом; слова — `diary.entry.*` (ADR-0044). */
function describeEntry(
  entry: DiaryLog,
  names: DiaryEntryNames,
  t: TFunction,
): DiaryEntryDescription {
  return describeDiaryEntry(entry, names, (key, values) =>
    t(`diary.${key}`, values),
  );
}

/** «понедельник, 5 октября» / «dushanba, 5-oktabr» — на языке экрана (ADR-0052). */
function dayFormat(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(formatLocale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * Записи дневника за две недели — все шесть видов одной лентой по дням.
 *
 * Раньше семья из Telegram не видела ни одной своей записи: бот принимал их
 * и забывал, а список жил только в веб-кабинете, которого у неё нет
 * (`docs/AUDIT_BLOCKERS.md`, раздел B; ADR-0044).
 *
 * Исправить и удалить можно только свою запись — как в кабинете: запись
 * бабушки — её свидетельство, и мама поправляет его, спросив бабушку, а не за
 * её спиной. Отметку «съедено» из плана дня здесь не правят: её снимают в
 * плане, иначе план и дневник разошлись бы.
 */
export function DiaryEntries({
  session,
  onAdd,
}: {
  session: Session;
  /** Открыть «Добавить запись» — из пустого состояния. */
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const diary = useDiaryEntries(session.patientId);
  const family = useFamily(session.patientId);
  const seizureTypes = useSeizureTypes();
  const durationOptions = useDurationOptions();
  const medications = useMedications(session.patientId);
  const { update, remove } = useEntryMutations(session.patientId);
  const [editing, setEditing] = useState<DiaryLog | null>(null);

  const names: DiaryEntryNames = useMemo(
    () => ({
      seizureTypes: toMap(seizureTypes.data),
      durationOptions: toMap(durationOptions.data),
      medications: toMap(medications.data),
    }),
    [seizureTypes.data, durationOptions.data, medications.data],
  );

  const members = family.data ?? [];
  const me = members.find((member) => member.is_me)?.id ?? null;
  const authors = new Map(
    members.map((member) => [member.id, member.full_name]),
  );
  const groups = groupByDay(diary.entries ?? []);
  const hasOwnMenuMarks = (diary.entries ?? []).some(
    (entry) =>
      entry.kind === "meals" &&
      entry.menu_item_id !== null &&
      entry.created_by !== null &&
      entry.created_by === me,
  );

  return (
    <Section
      title={t("diary.entriesTitle", { days: DIARY_DAYS })}
      density="compact"
    >
      {/* Один раз над лентой, а не под каждой отметкой: подсказка под каждой
          строкой «съедено» повторялась десятки раз (аудит 12.11.2026). */}
      {hasOwnMenuMarks && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("diary.fromMenuHint")}
        </p>
      )}

      <AsyncSection
        loading={diary.isPending}
        skeleton={null}
        error={
          diary.error !== null
            ? {
                title: t("diary.loadError"),
                description:
                  errorMessageOf(diary.error) ?? t("diary.loadErrorHint"),
              }
            : null
        }
        // Без сети об этом говорит лента — один раз на экран: график ниже
        // молчит (правило П27).
        waiting={diary.isWaiting ? t("errors.waitingForNetwork") : null}
        retryLabel={t("actions.retry")}
        onRetry={diary.refetch}
        isEmpty={diary.entries !== undefined && diary.entries.length === 0}
        empty={
          <EmptyState
            icon={NotebookPen}
            title={t("diary.emptyTitle")}
            description={t("diary.emptyBody")}
            action={
              <Button type="button" className="min-h-touch" onClick={onAdd}>
                {t("diary.add.action")}
              </Button>
            }
          />
        }
      >
        <div className="flex flex-col gap-section">
          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-field">
              <h3 className="m-0 text-card-title first-letter:uppercase">
                {dayLabel(group.day, t)}
              </h3>
              <ul className="m-0 flex list-none flex-col gap-field p-0">
                {group.entries.map((entry) => (
                  <li key={`${entry.kind}-${entry.id}`}>
                    <Entry
                      entry={entry}
                      names={names}
                      own={entry.created_by !== null && entry.created_by === me}
                      author={
                        entry.created_by === null
                          ? undefined
                          : authors.get(entry.created_by)
                      }
                      deleting={
                        remove.isPending && remove.variables?.id === entry.id
                      }
                      onEdit={() => {
                        update.reset();
                        setEditing(entry);
                      }}
                      onDelete={() =>
                        remove.mutate(
                          { kind: entry.kind, id: entry.id },
                          {
                            onSuccess: () => toast.success(t("diary.deleted")),
                            onError: (error) =>
                              toast.error(
                                errorMessageOf(error) ??
                                  t("diary.deleteFailed"),
                              ),
                          },
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </AsyncSection>

      {editing !== null && (
        <EntryEditSheet
          key={`${editing.kind}-${editing.id}`}
          target={{ entry: editing }}
          title={describeEntry(editing, names, t).title}
          seizureTypes={seizureTypes.data ?? []}
          durationOptions={durationOptions.data ?? []}
          medications={medications.data ?? []}
          pending={update.isPending}
          error={update.error}
          onSave={(body, onSaved) =>
            update.mutate({ logId: editing.id, body }, { onSuccess: onSaved })
          }
          onClose={() => setEditing(null)}
        />
      )}
    </Section>
  );
}

function Entry({
  entry,
  names,
  own,
  author,
  deleting,
  onEdit,
  onDelete,
}: {
  entry: DiaryLog;
  names: DiaryEntryNames;
  own: boolean;
  author: string | undefined;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { title, lines } = describeEntry(entry, names, t);
  const Icon = KIND_ICON[entry.kind];
  const occurredAt = new Date(entry.occurred_at);
  const fromMenu = entry.kind === "meals" && entry.menu_item_id !== null;
  const who = own
    ? t("diary.wroteByMe")
    : author === undefined
      ? null
      : t("diary.wroteBy", { name: author });

  return (
    <DiaryEntryCard
      title={title}
      occurredAt={occurredAt}
      actions={
        own && !fromMenu ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onEdit}
              aria-label={t("diary.editAria", { title })}
            >
              {t("diary.edit")}
            </Button>
            <TelegramConfirmDialog
              trigger={
                <RemoveButton
                  label={deleting ? t("diary.deleting") : t("diary.delete")}
                  disabled={deleting}
                  aria-label={t("diary.deleteAria", { title })}
                />
              }
              title={t("diary.confirmTitle", { title })}
              description={t("diary.confirmBody", {
                when: formatOccurredAt(occurredAt),
              })}
              confirmLabel={t("diary.confirmYes")}
              cancelLabel={t("actions.cancel")}
              onConfirm={onDelete}
            />
          </>
        ) : undefined
      }
    >
      <div className="flex gap-field">
        <Icon
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
        />
        <ul className="m-0 flex min-w-0 list-none flex-col gap-1 p-0 text-sm">
          {lines.map((line, index) => (
            <li key={`${index}-${line}`} className="break-words">
              {line}
            </li>
          ))}
          {who !== null && <li className="text-muted-foreground">{who}</li>}
        </ul>
      </div>
    </DiaryEntryCard>
  );
}

function toMap(
  options: readonly { id: string; name: string }[] | undefined,
): Map<string, string> {
  return new Map((options ?? []).map((option) => [option.id, option.name]));
}

interface DayGroup {
  key: string;
  day: Date;
  entries: DiaryLog[];
}

/** Группы по местным суткам; записи уже идут от новых к старым. */
function groupByDay(entries: readonly DiaryLog[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const at = new Date(entry.occurred_at);
    const key = at.toDateString();
    const last = groups.at(-1);
    if (last?.key === key) {
      last.entries.push(entry);
    } else {
      groups.push({
        key,
        day: new Date(at.getFullYear(), at.getMonth(), at.getDate()),
        entries: [entry],
      });
    }
  }
  return groups;
}

function dayLabel(day: Date, t: (key: string) => string): string {
  const today = new Date();
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const diff = Math.round((start.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return t("diary.today");
  if (diff === 1) return t("diary.yesterday");
  return dayFormat().format(day);
}
