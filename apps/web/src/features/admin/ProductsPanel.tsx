import { DataTable } from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { ProductEditor } from "./ProductEditor";
import { ProductImportPanel } from "./ProductImportPanel";
import { FIELD_CONTROL } from "../../components/Field";
import type { Product } from "./types";
import {
  EMPTY_PRODUCT_FILTERS,
  useAdminProducts,
  useProductCategories,
  type ProductFilters,
} from "./useAdminProducts";

type View =
  | { kind: "list" }
  /** `product: null` — заведение новой позиции */
  | { kind: "form"; product: Product | null }
  | { kind: "import" };

/**
 * Справочник продуктов администратора (раздел 8.3 ТЗ, «Админ / Продукты»).
 *
 * Список, карточка позиции и импорт живут в одном разделе маршрута:
 * `/app/$section` не знает о вложенных путях, поэтому что показывать, решает
 * состояние экрана.
 */
export function ProductsPanel() {
  const { t } = useTranslation("admin");

  const [filters, setFilters] = useState<ProductFilters>(EMPTY_PRODUCT_FILTERS);
  const [view, setView] = useState<View>({ kind: "list" });
  /** Название последней сохранённой позиции — подтверждение после возврата к списку */
  const [savedName, setSavedName] = useState<string | null>(null);

  // Поиск уходит с задержкой: иначе полнотекстовый запрос дёргается на каждой букве.
  const debouncedQuery = useDebouncedValue(filters.q, 300);
  const products = useAdminProducts({ ...filters, q: debouncedQuery });

  const rows = useMemo(() => products.data?.items ?? [], [products.data]);

  const categories = useProductCategories();
  const categoryNames = useMemo(
    () =>
      new Map((categories.data ?? []).map((c) => [c.id, c.name_ru] as const)),
    [categories.data],
  );

  const columns = useMemo<ColumnDef<Product, unknown>[]>(
    () => [
      { accessorKey: "name_ru", header: t("products.columns.name") },
      {
        accessorKey: "category_id",
        header: t("products.columns.category"),
        cell: ({ row }) => (
          <button
            type="button"
            title={row.original.category_id}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                categoryId: row.original.category_id,
              }))
            }
            className="min-h-touch text-primary underline"
          >
            {categoryNames.get(row.original.category_id) ??
              t("products.columns.unknownCategory")}
          </button>
        ),
      },
      {
        accessorKey: "kcal_100g",
        header: t("products.columns.kcal"),
        cell: numeric(0),
      },
      {
        accessorKey: "fat_100g",
        header: t("products.columns.fat"),
        cell: numeric(1),
      },
      {
        accessorKey: "protein_100g",
        header: t("products.columns.protein"),
        cell: numeric(1),
      },
      {
        accessorKey: "carbs_100g",
        header: t("products.columns.carbs"),
        cell: numeric(1),
      },
      {
        accessorKey: "fiber_100g",
        header: t("products.columns.fiber"),
        cell: numeric(1),
      },
      { accessorKey: "source", header: t("products.columns.source") },
      {
        accessorKey: "source_version",
        header: t("products.columns.sourceVersion"),
      },
      {
        accessorKey: "verified_at",
        header: t("products.columns.verifiedAt"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.original.verified_at}
          </span>
        ),
      },
      {
        accessorKey: "is_active",
        header: t("products.columns.status"),
        cell: ({ row }) =>
          row.original.is_active ? (
            <span className="text-success">{t("products.status.active")}</span>
          ) : (
            <span className="text-muted-foreground italic">
              {t("products.status.inactive")}
            </span>
          ),
      },
      {
        id: "actions",
        header: t("products.columns.actions"),
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => {
              setSavedName(null);
              setView({ kind: "form", product: row.original });
            }}
            className="min-h-touch rounded-lg border border-border px-3 text-foreground"
          >
            {t("products.edit")}
          </button>
        ),
      },
    ],
    [t, categoryNames],
  );

  if (view.kind === "import") {
    return <ProductImportPanel onDone={() => setView({ kind: "list" })} />;
  }

  if (view.kind === "form") {
    return (
      <ProductEditor
        product={view.product}
        categories={categories.data ?? []}
        onSaved={(product) => {
          setSavedName(product.name_ru);
          setView({ kind: "list" });
        }}
        onCancel={() => setView({ kind: "list" })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-lg font-semibold">{t("products.title")}</h2>
          <p className="mt-1 mb-0 text-muted-foreground">
            {t("products.intro")}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              setSavedName(null);
              setView({ kind: "form", product: null });
            }}
            className="min-h-touch rounded-lg bg-primary px-4 font-semibold text-primary-foreground"
          >
            {t("products.create")}
          </button>
          <button
            type="button"
            onClick={() => setView({ kind: "import" })}
            className="min-h-touch rounded-lg border border-border px-4 text-foreground"
          >
            {t("products.importCsv")}
          </button>
        </div>
      </div>

      <fieldset className="m-0 flex flex-wrap items-end gap-4 border-0 p-0">
        <legend className="sr-only">{t("products.filters.legend")}</legend>

        <div className="max-w-md flex-1">
          <label
            className="mb-1.5 block text-sm font-medium"
            htmlFor="admin-product-search"
          >
            {t("products.filters.search")}
          </label>
          <input
            id="admin-product-search"
            type="search"
            value={filters.q}
            placeholder={t("products.filters.searchPlaceholder")}
            onChange={(event) =>
              setFilters((current) => ({ ...current, q: event.target.value }))
            }
            className={FIELD_CONTROL}
          />
        </div>

        {filters.categoryId !== "" && (
          <button
            type="button"
            onClick={() =>
              setFilters((current) => ({ ...current, categoryId: "" }))
            }
            className="min-h-touch rounded-lg border border-border px-4 text-foreground"
          >
            {t("products.filters.clearCategory", {
              id:
                categoryNames.get(filters.categoryId) ??
                t("products.columns.unknownCategory"),
            })}
          </button>
        )}
      </fieldset>

      {savedName !== null && (
        <p role="status" className="m-0 text-success">
          {t("products.saved", { name: savedName })}
        </p>
      )}

      {products.isError && (
        <FormError>
          {errorMessageOf(products.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {products.isLoading ? (
        <p role="status" className="text-muted-foreground">
          {t("products.loading")}
        </p>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          caption={t("products.table.caption")}
          emptyState={t("products.empty")}
          labels={{
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            pageStatus: (page, total) => t("table.pageStatus", { page, total }),
          }}
        />
      )}

      {products.data !== undefined && products.data.total > rows.length && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("table.truncated", {
            shown: rows.length,
            total: products.data.total,
          })}
        </p>
      )}
    </div>
  );
}

/** Числовая ячейка с фиксированным числом знаков и моноширинными цифрами. */
function numeric(digits: number) {
  return function NumericCell({ getValue }: { getValue: () => unknown }) {
    const value = getValue();
    return (
      <span className="tabular-nums">
        {typeof value === "number" ? value.toFixed(digits) : "—"}
      </span>
    );
  };
}
