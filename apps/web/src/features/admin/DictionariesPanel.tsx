import {
  AsyncSection,
  Button,
  DataTable,
  EmptyState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { ListOrdered, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { DictionaryEntryForm } from "./DictionaryEntryForm";
import { SectionHeading } from "./SectionHeading";
import { TableSkeleton } from "./TableSkeleton";
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
    <div className="flex flex-col gap-block">
      <SectionHeading title={t("dictionaries.title")} />

      <Tabs
        value={kind}
        onValueChange={(value) => setKind(value as DictionaryKind)}
        className="gap-block"
      >
        {/* Вкладки второго уровня — линейным вариантом кита: иначе два
            одинаковых переключателя подряд читаются как один. */}
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList variant="line" aria-label={t("dictionaries.tabsLabel")}>
            {DICTIONARY_KINDS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(`dictionaries.kinds.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {DICTIONARY_KINDS.map((value) => (
          <TabsContent key={value} value={value}>
            {/* Свой экземпляр на справочник: состояние правки не должно
                переезжать со вкладки на вкладку. */}
            <DictionaryEditor kind={value} />
          </TabsContent>
        ))}
      </Tabs>
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

  function startCreating() {
    create.reset();
    setEditing({ kind: "create" });
  }

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
        ),
      },
    ],
    [t, resetUpdate],
  );

  return (
    <div className="flex flex-col gap-block">
      <div>
        <Button type="button" onClick={startCreating}>
          <Plus aria-hidden="true" />
          {t("dictionaries.create")}
        </Button>
      </div>

      {editing.kind === "create" && (
        <DictionaryEntryForm
          mode="create"
          defaultValues={{ nameRu: "", sort: nextSort }}
          pending={create.isPending}
          error={create.error}
          onCancel={() => setEditing({ kind: "none" })}
          onSubmit={(body) =>
            create.mutate(body, {
              onSuccess: (saved) => {
                setEditing({ kind: "none" });
                toast.success(t("dictionaries.saved", { name: saved.name_ru }));
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
              <Button type="button" onClick={startCreating}>
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
