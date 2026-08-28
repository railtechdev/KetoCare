import { DataTable } from "@ketocare/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { api, errorMessageOf } from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { FIELD_CONTROL } from "../../components/Field";

interface ProductRow {
  id: string;
  name: string;
  kcal: number;
  fat: number;
  protein: number;
  carbs: number;
  fiber: number;
  source: string;
  sourceVersion: string;
}

/** Справочник продуктов для родителя (раздел 8.1 ТЗ, раздел «products»). */
export function ProductsPage() {
  const { t } = useTranslation("products");
  const [query, setQuery] = useState("");

  // Запрос уходит с задержкой: иначе полнотекстовый поиск дёргается на каждой букве.
  const debounced = useDebouncedValue(query, 300);
  const trimmed = debounced.trim();

  const products = useQuery({
    queryKey: ["products", "list", trimmed],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ProductRow[]> => {
      const { data, error } = await api.GET("/api/v1/products", {
        params: { query: { q: trimmed || undefined, limit: 200, offset: 0 } },
      });
      if (error || !data) throw error ?? new Error("Empty products response");

      return data.items.map((item) => ({
        id: item.id,
        name: item.name_ru,
        kcal: item.kcal_100g,
        fat: item.fat_100g,
        protein: item.protein_100g,
        carbs: item.carbs_100g,
        fiber: item.fiber_100g,
        source: item.source,
        sourceVersion: item.source_version,
      }));
    },
  });

  const columns = useMemo<ColumnDef<ProductRow, unknown>[]>(
    () => [
      { accessorKey: "name", header: t("columns.name") },
      { accessorKey: "kcal", header: t("columns.kcal"), cell: numeric(0) },
      { accessorKey: "fat", header: t("columns.fat"), cell: numeric(1) },
      {
        accessorKey: "protein",
        header: t("columns.protein"),
        cell: numeric(1),
      },
      { accessorKey: "carbs", header: t("columns.carbs"), cell: numeric(1) },
      { accessorKey: "fiber", header: t("columns.fiber"), cell: numeric(1) },
      { accessorKey: "source", header: t("columns.source") },
    ],
    [t],
  );

  const rows = products.data ?? [];

  return (
    <section className="flex flex-col gap-4">
      <h1 className="m-0 text-xl font-semibold">{t("title")}</h1>

      <div className="max-w-md">
        <label
          className="mb-1.5 block text-sm font-medium"
          htmlFor="product-search"
        >
          {t("search.label")}
        </label>
        <input
          id="product-search"
          type="search"
          value={query}
          placeholder={t("search.placeholder")}
          onChange={(event) => setQuery(event.target.value)}
          className={FIELD_CONTROL}
        />
      </div>

      <p className="m-0 text-sm text-muted">{t("per100g")}</p>

      {products.isError && (
        <FormError>
          {errorMessageOf(products.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {products.isLoading ? (
        <p role="status" className="text-muted">
          {t("loading")}
        </p>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          caption={t("table.caption")}
          emptyState={
            trimmed === "" ? t("empty.noQuery") : t("empty.noResults")
          }
          labels={{
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            pageStatus: (page, total) => t("table.pageStatus", { page, total }),
          }}
        />
      )}
    </section>
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
