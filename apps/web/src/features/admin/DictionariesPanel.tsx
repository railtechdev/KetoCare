import {
  AsyncSection,
  ConfirmDialog,
  FormSheet,
  Button,
  DataTable,
  EmptyState,
  toast,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { ListOrdered, Plus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { SelectField } from "../../components/Field";
import { errorMessageOf } from "../../lib/api";
import { useSectionTab } from "../../routes/useSectionTab";
import { DictionaryEntryForm } from "./DictionaryEntryForm";
import { SubPageHeader } from "../../components/SubPageHeader";
import { TableSkeleton } from "./TableSkeleton";
import {
  DICTIONARY_KINDS,
  useCreateDictionaryEntryMutation,
  useDictionaryEntries,
  useDeleteDictionaryEntryMutation,
  useUpdateDictionaryEntryMutation,
  type DictionaryKind,
} from "./useDictionaries";
import type { DictionaryEntry } from "./types";

type Editing =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "entry"; entry: DictionaryEntry };

/**
 * Справочники (раздел 8.1 ТЗ, раздел админа `dictionaries`).
 *
 * Значения наполняются миграцией-сидом, а дальше правятся здесь: тип приступа и
 * метод измерения кетонов выбирает семья в дневнике, и добавляет их клиника, а
 * не разработчик.
 */
export function DictionariesPanel({
  chrome = "tab",
}: {
  chrome?: "tab" | "screen";
}) {
  const { t } = useTranslation("admin");
  const selectId = useId();

  // Справочник выбирается переключателем, а не второй полосой вкладок:
  // админка уже открыта вкладкой, а вкладки не вкладываются в вкладки —
  // две одинаковые полосы подряд читаются как одна (правило П29).
  const [kind, setKind] = useSectionTab<DictionaryKind>(
    "kind",
    DICTIONARY_KINDS,
    "seizure-types",
  );

  // Состояние правки живёт здесь, а не в редакторе: первичное действие раздела
  // стоит в шапке панели (правило П31), а шапка принадлежит этому компоненту.
  const [editing, setEditing] = useState<Editing>({ kind: "none" });

  const createButton = (
    <Button type="button" onClick={() => setEditing({ kind: "create" })}>
      <Plus aria-hidden="true" />
      {t("dictionaries.create")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-block">
      {chrome === "tab" ? (
        <SubPageHeader title={t("dictionaries.title")} actions={createButton} />
      ) : (
        <div className="flex flex-wrap gap-field">{createButton}</div>
      )}

      <SelectField
        id={selectId}
        label={t("dictionaries.tabsLabel")}
        width="medium"
        value={kind}
        onChange={(event) => {
          setKind(event.target.value as DictionaryKind);
          // Правка принадлежит покинутому справочнику: оставить её открытой
          // значило бы предложить сохранить тип приступа в методы кетонов.
          setEditing({ kind: "none" });
        }}
      >
        {DICTIONARY_KINDS.map((value) => (
          <option key={value} value={value}>
            {t(`dictionaries.kinds.${value}`)}
          </option>
        ))}
      </SelectField>

      {/* Свой экземпляр на справочник: загруженные значения не должны
          переезжать с одного справочника на другой. */}
      <DictionaryEditor
        key={kind}
        kind={kind}
        editing={editing}
        onEditingChange={setEditing}
      />
    </div>
  );
}

function DictionaryEditor({
  kind,
  editing,
  onEditingChange,
}: {
  kind: DictionaryKind;
  editing: Editing;
  onEditingChange: (next: Editing) => void;
}) {
  const { t } = useTranslation("admin");

  const entries = useDictionaryEntries(kind);
  const create = useCreateDictionaryEntryMutation(kind);
  const update = useUpdateDictionaryEntryMutation(kind);
  const remove = useDeleteDictionaryEntryMutation(kind);
  const setEditing = onEditingChange;

  const resetUpdate = update.reset;

  const rows = useMemo(() => entries.data?.items ?? [], [entries.data]);

  // Новое значение становится в конец списка: порядок задаётся числом, и
  // подставленный ноль отправил бы его в начало вперёд существующих.
  const nextSort = useMemo(
    () => rows.reduce((max, entry) => Math.max(max, entry.sort), 0) + 1,
    [rows],
  );

  const columns = useMemo<ColumnDef<DictionaryEntry, unknown>[]>(
    () => [
      { accessorKey: "name_ru", header: t("dictionaries.columns.name") },
      // Код показывается только там, где он есть: у методов измерения кетонов
      // такой колонки нет и быть не должно.
      ...(kind === "seizure-types"
        ? [
            {
              accessorKey: "code",
              header: t("dictionaries.columns.code"),
              cell: ({ row }: { row: { original: DictionaryEntry } }) => (
                <span className="tabular-nums">
                  {(row.original as { code?: string | null }).code ?? "—"}
                </span>
              ),
            } as ColumnDef<DictionaryEntry, unknown>,
          ]
        : []),
      {
        accessorKey: "sort",
        header: t("dictionaries.columns.sort"),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.sort}</span>
        ),
      },
      {
        id: "actions",
        header: t("dictionaries.columns.actions"),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-field">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                resetUpdate();
                setEditing({ kind: "entry", entry: row.original });
              }}
            >
              {t("dictionaries.edit")}
            </Button>

            {/* Опечатка в названии иначе остаётся в списках у всех семей
                навсегда: переименование ретроспективно меняет смысл уже
                записанных приступов. Значение, на которое ссылаются дневники,
                сервер удалить не даст — и правильно. */}
            <ConfirmDialog
              trigger={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t("dictionaries.deleteEntry", {
                    name: row.original.name_ru,
                  })}
                >
                  {t("dictionaries.delete")}
                </Button>
              }
              title={t("dictionaries.confirmDelete", {
                name: row.original.name_ru,
              })}
              description={t("dictionaries.confirmDeleteBody")}
              confirmLabel={t("common:actions.delete")}
              cancelLabel={t("common:actions.cancel")}
              destructive
              onConfirm={() =>
                remove.mutate(row.original.id, {
                  onSuccess: () => toast.success(t("dictionaries.deleted")),
                  onError: (error) =>
                    toast.error(
                      errorMessageOf(error) ?? t("common:errors.unexpected"),
                    ),
                })
              }
            />
          </div>
        ),
      },
    ],
    [t, kind, remove, resetUpdate, setEditing],
  );

  return (
    <div className="flex flex-col gap-block">
      {/* Форма — панелью, а не блоком над таблицей: справочник читают чаще,
          чем правят, и раскрытая форма отодвигала список значений вниз
          ровно тогда, когда с ним надо было свериться (правило П32). */}
      <FormSheet
        open={editing.kind !== "none"}
        onOpenChange={(open) => {
          if (!open) setEditing({ kind: "none" });
        }}
        title={
          editing.kind === "entry"
            ? t("dictionaries.editTitle")
            : t("dictionaries.createTitle")
        }
      >
        {editing.kind === "create" && (
          <DictionaryEntryForm
            mode="create"
            withCode={kind === "seizure-types"}
            defaultValues={{ nameRu: "", sort: nextSort, code: "" }}
            pending={create.isPending}
            error={create.error}
            onCancel={() => setEditing({ kind: "none" })}
            onSubmit={(body) =>
              create.mutate(body, {
                onSuccess: (saved) => {
                  setEditing({ kind: "none" });
                  toast.success(
                    t("dictionaries.saved", { name: saved.name_ru }),
                  );
                },
              })
            }
          />
        )}

        {editing.kind === "entry" && (
          <DictionaryEntryForm
            // Форма пересоздаётся при выборе другого значения: react-hook-form
            // читает defaultValues только при монтировании.
            key={editing.entry.id}
            mode="edit"
            withCode={kind === "seizure-types"}
            defaultValues={{
              nameRu: editing.entry.name_ru,
              sort: editing.entry.sort,
              code: (editing.entry as { code?: string | null }).code ?? "",
            }}
            pending={update.isPending}
            error={update.error}
            onCancel={() => setEditing({ kind: "none" })}
            onSubmit={(body) =>
              update.mutate(
                { entryId: editing.entry.id, body },
                {
                  onSuccess: (saved) => {
                    setEditing({ kind: "none" });
                    toast.success(
                      t("dictionaries.saved", { name: saved.name_ru }),
                    );
                  },
                },
              )
            }
          />
        )}
      </FormSheet>

      {/* Ошибка не прячет уже загруженные строки — правило в AsyncSection. */}
      <AsyncSection
        loading={entries.isLoading}
        skeleton={
          <TableSkeleton label={t("dictionaries.loading")} columns={3} />
        }
        error={
          entries.isError
            ? {
                title: t("dictionaries.error"),
                description:
                  errorMessageOf(entries.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void entries.refetch()}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={ListOrdered}
            title={t("dictionaries.empty.title")}
            description={t("dictionaries.empty.description")}
            action={
              <Button
                type="button"
                onClick={() => setEditing({ kind: "create" })}
              >
                <Plus aria-hidden="true" />
                {t("dictionaries.create")}
              </Button>
            }
          />
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          caption={t(`dictionaries.table.caption.${kind}`)}
          emptyState={null}
          labels={{
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            pageStatus: (page, total) => t("table.pageStatus", { page, total }),
          }}
        />
      </AsyncSection>
    </div>
  );
}
