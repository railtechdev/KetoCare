import {
  AsyncSection,
  Button,
  EmptyState,
  SegmentedControl,
  describeDiaryEntry,
  type DiaryEntryDescription,
  type DiaryEntryKind,
  type DiaryEntryNames,
  Section,
  cn,
  formatLocale,
  formatNumber,
  formatTime,
  toast,
} from "@ketocare/ui";
import { ChevronDown, NotebookPen, Pencil } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useFamily } from "../family/useFamily";
import type { Session } from "../session/useSession";
import { EntryEditSheet } from "./EntryEditSheet";
import { KIND_ICON } from "./kinds";
import {
  DIARY_DAYS,
  DIARY_KINDS,
  type DiaryLog,
  useDiaryEntries,
  useDurationOptions,
  useEntryMutations,
  useMedications,
  dictionaryStatusOf,
  recentSeizureTypesOf,
  useRecentSeizureTypes,
  useSeizureTypes,
} from "./useDiary";

/** Отбор ленты: все записи или один вид. */
export type DiaryFilter = "all" | DiaryEntryKind;

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
 * **Раскрыты сегодня и вчера** (аудит Mini App 21.11.2026, Д1). Лента за две
 * недели целиком — это около 140 записей и восемнадцать экранов; более
 * ранние дни свёрнуты в строку «пятница, 13 ноября — 12 записей: кетоны 4, …»
 * и раскрываются нажатием. Раскрытое помнится, пока вкладка открыта. Над
 * лентой — отбор по виду записи.
 *
 * Исправить и удалить можно только свою запись — как в кабинете: запись
 * бабушки — её свидетельство, и мама поправляет его, спросив бабушку, а не за
 * её спиной. Удаление — внутри правки, а не кнопкой в строке (Д2). Отметку
 * «съедено» из плана дня здесь не правят: её снимают в плане, иначе план и
 * дневник разошлись бы.
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
  const recentSeizureTypes = useRecentSeizureTypes(session.patientId);
  const durationOptions = useDurationOptions();
  const medications = useMedications(session.patientId);
  const { update, remove } = useEntryMutations(session.patientId);
  const [editing, setEditing] = useState<DiaryLog | null>(null);
  const [filter, setFilter] = useState<DiaryFilter>("all");
  // Раскрытое и свёрнутое человеком — поверх правила «сегодня и вчера».
  const [opened, setOpened] = useState<Record<string, boolean>>({});

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
  const shown = (diary.entries ?? []).filter(
    (entry) => filter === "all" || entry.kind === filter,
  );
  const groups = groupByDay(shown);
  const hasOwnMenuMarks = shown.some(
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
      {/* Семь вариантов на 360 px не помещаются в строку: полоса
          прокручивается вбок, а не распирает страницу. `min-w-0` — у
          fieldset минимальная ширина по содержимому. */}
      <SegmentedControl
        label={t("diary.filter.label")}
        value={filter}
        onChange={setFilter}
        items={(["all", ...DIARY_KINDS] as const).map((value) => ({
          value,
          label: t(`diary.filter.${value}`),
        }))}
        className="w-full min-w-0 flex-nowrap overflow-x-auto [&>label]:shrink-0"
      />

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
        isEmpty={diary.entries !== undefined && shown.length === 0}
        empty={
          filter !== "all" && (diary.entries?.length ?? 0) > 0 ? (
            <p className="m-0 text-muted-foreground">
              {t("diary.filter.empty")}
            </p>
          ) : (
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
          )
        }
      >
        <div className="flex flex-col gap-field">
          {groups.map((group) => (
            <DayGroupBlock
              key={group.key}
              group={group}
              open={opened[group.key] ?? daysAgo(group.day) <= 1}
              onToggle={(open) =>
                setOpened((current) => ({ ...current, [group.key]: open }))
              }
            >
              {group.entries.map((entry) => (
                <li key={`${entry.kind}-${entry.id}`}>
                  <DiaryRow
                    entry={entry}
                    names={names}
                    own={entry.created_by !== null && entry.created_by === me}
                    author={
                      entry.created_by === null
                        ? undefined
                        : authors.get(entry.created_by)
                    }
                    onEdit={() => {
                      update.reset();
                      remove.reset();
                      setEditing(entry);
                    }}
                  />
                </li>
              ))}
            </DayGroupBlock>
          ))}
        </div>
      </AsyncSection>

      {editing !== null && (
        <EntryEditSheet
          key={`${editing.kind}-${editing.id}`}
          target={{ entry: editing }}
          title={describeEntry(editing, names, t).title}
          seizureTypes={seizureTypes.data ?? []}
          seizureTypesStatus={dictionaryStatusOf(seizureTypes)}
          recentSeizureTypes={recentSeizureTypesOf(recentSeizureTypes)}
          durationOptions={durationOptions.data ?? []}
          medications={medications.data ?? []}
          pending={update.isPending}
          error={update.error}
          onSave={(body, onSaved) =>
            update.mutate({ logId: editing.id, body }, { onSuccess: onSaved })
          }
          onClose={() => setEditing(null)}
          deleting={remove.isPending}
          onDelete={() =>
            remove.mutate(
              { kind: editing.kind, id: editing.id },
              {
                onSuccess: () => {
                  toast.success(t("diary.deleted"));
                  setEditing(null);
                },
                onError: (error) =>
                  toast.error(errorMessageOf(error) ?? t("diary.deleteFailed")),
              },
            )
          }
        />
      )}
    </Section>
  );
}

/**
 * День ленты: заголовок-кнопка и записи под ним.
 *
 * Свёрнутый день говорит, что в нём лежит, — сколько записей и каких, — чтобы
 * искать нужный день, не раскрывая все подряд.
 */
function DayGroupBlock({
  group,
  open,
  onToggle,
  children,
}: {
  group: DayGroup;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const listId = useId();
  return (
    <section className="flex flex-col gap-field">
      <h3 className="m-0 text-card-title">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          className="flex min-h-touch w-full items-center gap-field rounded-lg text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => onToggle(!open)}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-5 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
          <span className="min-w-0">
            <span className="inline-block first-letter:uppercase">
              {dayLabel(group.day, t)}
            </span>
            {!open && (
              <span className="block text-sm font-normal text-muted-foreground">
                {daySummary(group.entries, t)}
              </span>
            )}
          </span>
        </button>
      </h3>
      <ul
        id={listId}
        hidden={!open}
        className="m-0 flex list-none flex-col gap-1 p-0"
      >
        {open && children}
      </ul>
    </section>
  );
}

/**
 * Одна запись — одной строкой (аудит Mini App 21.11.2026, Д2).
 *
 * Прежде карточка занимала 150 px: справа стояла полная дата «13.11.2026,
 * 10:56» под заголовком дня с той же датой, значение переносилось, а
 * «Записал(а): …» повторялось на каждой карточке. Теперь — время, значение
 * со способом через «·» и автор только тогда, когда записал не тот, кто
 * смотрит. Своя запись открывается для правки нажатием на строку; удаление —
 * внутри правки.
 */
function DiaryRow({
  entry,
  names,
  own,
  author,
  onEdit,
}: {
  entry: DiaryLog;
  names: DiaryEntryNames;
  own: boolean;
  author: string | undefined;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const { title, lines } = describeEntry(entry, names, t);
  const Icon = KIND_ICON[entry.kind];
  const occurredAt = new Date(entry.occurred_at);
  const fromMenu = entry.kind === "meals" && entry.menu_item_id !== null;

  const editable = own && !fromMenu;
  const frame =
    "flex w-full items-start gap-field rounded-lg border border-border bg-card px-3 py-2";
  const content = (
    <>
      <time
        dateTime={occurredAt.toISOString()}
        className="mt-0.5 shrink-0 text-sm text-muted-foreground tabular-nums"
      >
        {formatTime(occurredAt)}
      </time>
      <Icon
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-muted-foreground"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="break-words">
          <span className="font-medium">{title}</span>
          {lines.map((line, index) => (
            <span key={`${index}-${line}`}> · {line}</span>
          ))}
        </span>
        {!own && author !== undefined && (
          <span className="text-sm text-muted-foreground">
            {t("diary.wroteBy", { name: author })}
          </span>
        )}
      </span>
      {editable && (
        <Pencil
          aria-hidden="true"
          className="mt-1 size-4 shrink-0 text-muted-foreground"
        />
      )}
    </>
  );

  // Своя запись открывается нажатием на всю строку, а карандаш — только
  // подсказка. Отдельная кнопка 44 px со словом «Изменить» (по-узбекски
  // длиннее) забирала у значения около ста пикселей на 360 px, и своя
  // запись — а их в ленте большинство — ломалась на три-четыре строки
  // (аудит Mini App, Д2). Имя действия — в `aria-label`.
  return (
    <article aria-label={title}>
      {editable ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("diary.editAria", { title })}
          className={cn(
            frame,
            "min-h-touch text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          )}
        >
          {content}
        </button>
      ) : (
        <div className={frame}>{content}</div>
      )}
    </article>
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

/** Сколько суток назад был этот день: 0 — сегодня, 1 — вчера. */
function daysAgo(day: Date): number {
  const today = new Date();
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return Math.round((start.getTime() - day.getTime()) / 86_400_000);
}

function dayLabel(day: Date, t: (key: string) => string): string {
  const diff = daysAgo(day);
  if (diff === 0) return t("diary.today");
  if (diff === 1) return t("diary.yesterday");
  return dayFormat().format(day);
}

/** «12 записей: кетоны 4, вес 2» — виды в порядке бота. */
function daySummary(entries: readonly DiaryLog[], t: TFunction): string {
  const parts = DIARY_KINDS.flatMap((kind) => {
    const count = entries.filter((entry) => entry.kind === kind).length;
    return count === 0
      ? []
      : [
          t("diary.dayKind", {
            kind: t(`diary.dayKinds.${kind}`),
            number: formatNumber(count, 0),
          }),
        ];
  });
  return t("diary.daySummary", {
    count: entries.length,
    kinds: parts.join(", "),
  });
}
