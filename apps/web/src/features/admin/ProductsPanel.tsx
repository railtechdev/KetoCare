import {
  AsyncSection,
  Button,
  DataTable,
  EmptyState,
  toast,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { Apple, Plus, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { ProductEditor } from "./ProductEditor";
import { ProductImportPanel } from "./ProductImportPanel";
import { SubPageHeader } from "../../components/SubPageHeader";
import { TableSkeleton } from "./TableSkeleton";
import { Field } from "../../components/Field";
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
          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-0"
            title={row.original.category_id}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                categoryId: row.original.category_id,
              }))
            }
          >
            {categoryNames.get(row.original.category_id) ??
              t("products.columns.unknownCategory")}
          </Button>
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setView({ kind: "form", product: row.original })}
          >
            {t("products.edit")}
          </Button>
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
          setView({ kind: "list" });
          toast.success(t("products.saved", { name: product.name_ru }));
        }}
        onCancel={() => setView({ kind: "list" })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-block">
      <SubPageHeader
        title={t("products.title")}
        intro={t("products.intro")}
        actions={
          <>
            <Button
              type="button"
              onClick={() => setView({ kind: "form", product: null })}
            >
              <Plus aria-hidden="true" />
              {t("products.create")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setView({ kind: "import" })}
            >
              <Upload aria-hidden="true" />
              {t("products.importCsv")}
            </Button>
          </>
        }
      />

      <fieldset className="m-0 flex flex-wrap items-end gap-block border-0 p-0">
        <legend className="sr-only">{t("products.filters.legend")}</legend>

        <div className="min-w-56 flex-1 sm:max-w-md">
          <Field
            id="admin-product-search"
            type="search"
            label={t("products.filters.search")}
            placeholder={t("products.filters.searchPlaceholder")}
            value={filters.q}
            onChange={(event) =>
              setFilters((current) => ({ ...current, q: event.target.value }))
            }
          />
        </div>

        {filters.categoryId !== "" && (
          <Button
            type="button"
            variant="outline"
            className="min-h-touch"
            onClick={() =>
              setFilters((current) => ({ ...current, categoryId: "" }))
            }
          >
            <X aria-hidden="true" />
            {t("products.filters.clearCategory", {
              id:
                categoryNames.get(filters.categoryId) ??
                t("products.columns.unknownCategory"),
            })}
          </Button>
        )}
      </fieldset>

      {/* Ошибка не прячет уже загруженные строки — правило в AsyncSection. */}
      <AsyncSection
        loading={products.isLoading}
        skeleton={<TableSkeleton label={t("products.loading")} columns={6} />}
        error={
          products.isError
            ? {
                title: t("products.error"),
                description:
                  errorMessageOf(products.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void products.refetch()}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={Apple}
            title={t("products.empty.title")}
            description={t("products.empty.description")}
            action={
              <Button
                type="button"
                onClick={() => setView({ kind: "form", product: null })}
              >
                <Plus aria-hidden="true" />
                {t("products.create")}
              </Button>
            }
          />
        }
      >
        <DataTable
          columns={columns}
          data={rows}
          caption={t("products.table.caption")}
          emptyState={null}
          labels={{
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            pageStatus: (page, total) => t("table.pageStatus", { page, total }),
          }}
        />
      </AsyncSection>

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
