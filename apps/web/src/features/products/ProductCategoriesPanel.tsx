import {
  AsyncSection,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FormFooter,
  FormSheet,
  Section,
  toast,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { ListOrdered, Merge, Plus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field, SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import type { ProductCategory } from "../admin/types";
import { useProductCategories } from "../admin/useAdminProducts";
import {
  useCreateCategoryMutation,
  useDeleteCategoryMutation,
  useMergeCategoryMutation,
  useUpdateCategoryMutation,
} from "./useCategoryMutations";

type Editing =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; category: ProductCategory }
  | { kind: "merge"; category: ProductCategory };

/**
 * Справочник категорий продуктов.
 *
 * Категория рождалась побочным эффектом импорта: чем написана колонка файла, то
 * и появлялось в списке. Переименовать или слить было нечем, а на пустом
 * справочнике завести продукт руками нельзя вовсе — форма требует категорию.
 *
 * Слияние здесь — не удобство, а единственный способ свести разъехавшийся
 * справочник: удалить непустую категорию сервер не даёт (продукты остались бы
 * без неё), а переносить позиции по одной — работа на день.
 *
 * Канонический список категорий — вопрос медицинской команды (вопрос 26 в
 * `docs/medical/OPEN_QUESTIONS.md`); до ответа справочник ведёт клиника.
 */
export function ProductCategoriesPanel() {
  const { t } = useTranslation("products");
  const categories = useProductCategories();
  const [editing, setEditing] = useState<Editing>({ kind: "none" });

  const rows = useMemo(() => categories.data ?? [], [categories.data]);

  const columns = useMemo<ColumnDef<ProductCategory, unknown>[]>(
    () => [
      { accessorKey: "name_ru", header: t("categories.columns.name") },
      {
        accessorKey: "sort",
        header: t("categories.columns.sort"),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.sort}</span>
        ),
      },
      {
        accessorKey: "products",
        header: t("categories.columns.products"),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.products}</span>
        ),
      },
      {
        id: "actions",
        header: t("categories.columns.actions"),
        cell: ({ row }) => (
          <CategoryActions
            category={row.original}
            onEdit={() => setEditing({ kind: "edit", category: row.original })}
            onMerge={() =>
              setEditing({ kind: "merge", category: row.original })
            }
          />
        ),
      },
    ],
    [t],
  );

  return (
    <Section
      title={t("categories.title")}
      description={t("categories.intro")}
      action={
        <Button type="button" onClick={() => setEditing({ kind: "create" })}>
          <Plus aria-hidden="true" />
          {t("categories.create")}
        </Button>
      }
    >
      <AsyncSection
        loading={categories.isPending}
        skeleton={null}
        error={
          categories.isError
            ? {
                title: t("categories.loadError"),
                description:
                  errorMessageOf(categories.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void categories.refetch()}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={ListOrdered}
            title={t("categories.empty.title")}
            description={t("categories.empty.description")}
          />
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          caption={t("categories.table.caption")}
          emptyState={null}
          pageSize={0}
          labels={{
            previousPage: t("common:actions.retry"),
            nextPage: t("common:actions.retry"),
            pageStatus: () => "",
          }}
        />
      </AsyncSection>

      <CategoryFormSheet
        editing={editing}
        categories={rows}
        onClose={() => setEditing({ kind: "none" })}
      />
    </Section>
  );
}

function CategoryActions({
  category,
  onEdit,
  onMerge,
}: {
  category: ProductCategory;
  onEdit: () => void;
  onMerge: () => void;
}) {
  const { t } = useTranslation("products");
  const remove = useDeleteCategoryMutation();

  return (
    <div className="flex flex-wrap gap-field">
      <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
        {t("categories.actions.edit")}
      </Button>

      <Button type="button" variant="ghost" size="sm" onClick={onMerge}>
        <Merge aria-hidden="true" />
        {t("categories.actions.merge")}
      </Button>

      {/* Удаление предлагается только у пустой: сервер откажет и объяснит, но
          показывать заведомо отказную кнопку — обещание того, чего нет. */}
      {category.products === 0 && (
        <ConfirmDialog
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={remove.isPending}
            >
              {t("categories.actions.delete")}
            </Button>
          }
          title={t("categories.confirmDelete.title", {
            name: category.name_ru,
          })}
          description={t("categories.confirmDelete.body")}
          confirmLabel={t("categories.confirmDelete.confirm")}
          cancelLabel={t("common:actions.cancel")}
          onConfirm={() =>
            remove.mutate(category.id, {
              onSuccess: () => toast.success(t("categories.deleted")),
              onError: (error) =>
                toast.error(
                  errorMessageOf(error) ?? t("common:errors.unexpected"),
                ),
            })
          }
        />
      )}
    </div>
  );
}

function CategoryFormSheet({
  editing,
  categories,
  onClose,
}: {
  editing: Editing;
  categories: readonly ProductCategory[];
  onClose: () => void;
}) {
  if (editing.kind === "none") return null;
  if (editing.kind === "merge") {
    return (
      <MergeForm
        category={editing.category}
        categories={categories}
        onClose={onClose}
      />
    );
  }

  return (
    <EditForm
      category={editing.kind === "edit" ? editing.category : null}
      nextSort={categories.reduce((max, c) => Math.max(max, c.sort), 0) + 1}
      onClose={onClose}
    />
  );
}

function EditForm({
  category,
  nextSort,
  onClose,
}: {
  category: ProductCategory | null;
  nextSort: number;
  onClose: () => void;
}) {
  const { t } = useTranslation("products");
  const ids = useId();

  const [name, setName] = useState(category?.name_ru ?? "");
  const [sort, setSort] = useState(category?.sort ?? nextSort);

  const create = useCreateCategoryMutation();
  const update = useUpdateCategoryMutation(category?.id ?? "");
  const mutation = category === null ? create : update;

  return (
    <FormSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={
        category === null
          ? t("categories.form.createTitle")
          : t("categories.form.editTitle", { name: category.name_ru })
      }
      description={t("categories.form.intro")}
    >
      <form
        noValidate
        className="flex flex-col gap-block"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(
            { name_ru: name.trim(), sort },
            {
              onSuccess: () => {
                toast.success(t("categories.saved"));
                onClose();
              },
            },
          );
        }}
      >
        <Field
          id={`${ids}-name`}
          width="wide"
          label={t("categories.form.name")}
          hint={t("categories.form.nameHint")}
          value={name}
          required
          onChange={(event) => setName(event.target.value)}
        />

        <Field
          id={`${ids}-sort`}
          width="narrow"
          type="number"
          inputMode="numeric"
          min={0}
          max={9999}
          label={t("categories.form.sort")}
          hint={t("categories.form.sortHint")}
          value={sort}
          onChange={(event) => setSort(Number(event.target.value))}
        />

        {mutation.isError && (
          <FormError>
            {errorMessageOf(mutation.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <FormFooter
          submitLabel={t("categories.form.submit")}
          pendingLabel={t("categories.form.saving")}
          pending={mutation.isPending}
          onCancel={onClose}
          cancelLabel={t("common:actions.cancel")}
        />
      </form>
    </FormSheet>
  );
}

function MergeForm({
  category,
  categories,
  onClose,
}: {
  category: ProductCategory;
  categories: readonly ProductCategory[];
  onClose: () => void;
}) {
  const { t } = useTranslation("products");
  const ids = useId();

  const [target, setTarget] = useState("");
  const merge = useMergeCategoryMutation(category.id);

  const candidates = categories.filter((c) => c.id !== category.id);

  return (
    <FormSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("categories.merge.title", { name: category.name_ru })}
      description={t("categories.merge.intro", { count: category.products })}
    >
      <form
        noValidate
        className="flex flex-col gap-block"
        onSubmit={(event) => {
          event.preventDefault();
          if (target === "") return;
          merge.mutate(target, {
            onSuccess: (moved) => {
              toast.success(t("categories.merge.done", { count: moved }));
              onClose();
            },
          });
        }}
      >
        <SelectField
          id={`${ids}-target`}
          width="wide"
          label={t("categories.merge.target")}
          hint={t("categories.merge.targetHint")}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="">{t("categories.merge.placeholder")}</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name_ru} ({candidate.products})
            </option>
          ))}
        </SelectField>

        {merge.isError && (
          <FormError>
            {errorMessageOf(merge.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <FormFooter
          submitLabel={t("categories.merge.submit")}
          pendingLabel={t("categories.merge.merging")}
          pending={merge.isPending}
          onCancel={onClose}
          cancelLabel={t("common:actions.cancel")}
        />
      </form>
    </FormSheet>
  );
}
