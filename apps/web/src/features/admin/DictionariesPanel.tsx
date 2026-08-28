import * as Tabs from "@radix-ui/react-tabs";
import { DataTable } from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { DictionaryEntryForm } from "./DictionaryEntryForm";
import {
  DICTIONARY_KINDS,
  useCreateDictionaryEntryMutation,
  useDictionaryEntries,
  useUpdateDictionaryEntryMutation,
  type DictionaryKind,
} from "./useDictionaries";
import type { DictionaryEntry } from "./types";

/**
 * Справочники (раздел 8.1 ТЗ, раздел админа `dictionaries`).
 *
 * Значения наполняются миграцией-сидом, а дальше правятся здесь: тип приступа и
 * метод измерения кетонов выбирает семья в дневнике, и добавляет их клиника, а
 * не разработчик.
 */
export function DictionariesPanel() {
  const { t } = useTranslation("admin");
  const [kind, setKind] = useState<DictionaryKind>("seizure-types");

  return (
    <div className="flex flex-col gap-4">
      <h2 className="m-0 text-lg font-semibold">{t("dictionaries.title")}</h2>

      <Tabs.Root
        value={kind}
        onValueChange={(value) => setKind(value as DictionaryKind)}
      >
        <Tabs.List
          aria-label={t("dictionaries.tabsLabel")}
          className="flex flex-wrap gap-2 border-b border-line"
        >
          {DICTIONARY_KINDS.map((value) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="min-h-touch px-4 text-ink data-[state=active]:border-b-2 data-[state=active]:border-accent data-[state=active]:font-semibold"
            >
              {t(`dictionaries.kinds.${value}`)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {DICTIONARY_KINDS.map((value) => (
          <Tabs.Content key={value} value={value} className="pt-4">
            {/* Свой экземпляр на справочник: состояние правки не должно
                переезжать со вкладки на вкладку. */}
            <DictionaryEditor kind={value} />
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </div>
  );
}

type Editing =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "entry"; entry: DictionaryEntry };

function DictionaryEditor({ kind }: { kind: DictionaryKind }) {
  const { t } = useTranslation("admin");

  const entries = useDictionaryEntries(kind);
  const create = useCreateDictionaryEntryMutation(kind);
  const update = useUpdateDictionaryEntryMutation(kind);
  const [editing, setEditing] = useState<Editing>({ kind: "none" });

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
          <button
            type="button"
            onClick={() => {
              resetUpdate();
              setEditing({ kind: "entry", entry: row.original });
            }}
            className="min-h-touch rounded-lg border border-line px-3 text-ink"
          >
            {t("dictionaries.edit")}
          </button>
        ),
      },
    ],
    [t, resetUpdate],
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button
          type="button"
          onClick={() => {
            create.reset();
            setEditing({ kind: "create" });
          }}
          className="min-h-touch rounded-lg bg-accent px-4 font-semibold text-on-accent"
        >
          {t("dictionaries.create")}
        </button>
      </div>

      {entries.isError && (
        <FormError>
          {errorMessageOf(entries.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {editing.kind === "create" && (
        <DictionaryEntryForm
          mode="create"
          defaultValues={{ nameRu: "", sort: nextSort }}
          pending={create.isPending}
          error={create.error}
          onCancel={() => setEditing({ kind: "none" })}
          onSubmit={(body) =>
            create.mutate(body, {
              onSuccess: () => setEditing({ kind: "none" }),
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
          defaultValues={{
            nameRu: editing.entry.name_ru,
            sort: editing.entry.sort,
          }}
          pending={update.isPending}
          error={update.error}
          onCancel={() => setEditing({ kind: "none" })}
          onSubmit={(body) =>
            update.mutate(
              { entryId: editing.entry.id, body },
              { onSuccess: () => setEditing({ kind: "none" }) },
            )
          }
        />
      )}

      {entries.isLoading ? (
        <p role="status" className="text-muted">
          {t("dictionaries.loading")}
        </p>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          caption={t(`dictionaries.table.caption.${kind}`)}
          emptyState={t("dictionaries.empty")}
          labels={{
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            pageStatus: (page, total) => t("table.pageStatus", { page, total }),
          }}
        />
      )}
    </div>
  );
}
