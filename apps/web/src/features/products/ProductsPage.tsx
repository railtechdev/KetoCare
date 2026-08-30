import {
  AsyncSection,
  Button,
  DataTable,
  EmptyState,
  Skeleton,
} from "@ketocare/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Calculator, PackageSearch, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { SectionLink } from "../../components/SectionLink";
import { api, errorMessageOf } from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { useSectionQuery } from "../../routes/useSectionTab";

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

  // Запрос — в адресе: калькулятор, не нашедший продукт, ведёт сюда с уже
  // введённым словом, а семья не набирает его во второй раз. Поле при этом
  // остаётся отзывчивым — своё состояние нужно, чтобы каждая буква не ждала
  // навигации.
  const [urlQuery, setUrlQuery] = useSectionQuery();
  const [query, setQuery] = useState(urlQuery);

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
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          // Справочник без выхода в расчёт был тупиком: продукт находился, а
          // сделать с ним было нечего — калькулятор про него не знал, и его
          // приходилось искать там заново.
          <Button asChild variant="ghost" size="sm" className="min-h-touch">
            <SectionLink section="calculator" item={row.original.id}>
              <Calculator aria-hidden="true" />
              {t("actions.toCalculator")}
            </SectionLink>
          </Button>
        ),
      },
    ],
    [t],
  );

  const rows = products.data ?? [];

  // Пустых состояний два: до поиска показывается, что здесь будет, а по
  // неудачному запросу — как его исправить, с кнопкой сброса.
  const emptyState =
    trimmed === "" ? (
      <EmptyState
        icon={PackageSearch}
        title={t("empty.noQuery.title")}
        description={t("empty.noQuery.description")}
      />
    ) : (
      <EmptyState
        icon={SearchX}
        title={t("empty.noResults.title")}
        description={t("empty.noResults.description")}
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setQuery("");
              setUrlQuery("");
            }}
          >
            {t("empty.noResults.reset")}
          </Button>
        }
      />
    );

  return (
    <PageLayout title={t("title")} intro={t("intro")}>
      <Field
        id="product-search"
        type="search"
        label={t("search.label")}
        width="wide"
        value={query}
        placeholder={t("search.placeholder")}
        onChange={(event) => {
          setQuery(event.target.value);
          setUrlQuery(event.target.value);
        }}
      />

      {/* Четыре состояния — в AsyncSection: там же записано, почему упавшее
          обновление не должно прятать уже показанную выдачу (П15 канона).
          Пустое состояние отдано ему же, поэтому таблица своего не рисует. */}
      <AsyncSection
        loading={products.isLoading}
        skeleton={<ProductsSkeleton label={t("loading")} />}
        error={
          products.isError
            ? {
                title: t("error.title"),
                description:
                  errorMessageOf(products.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void products.refetch()}
        isEmpty={rows.length === 0}
        empty={emptyState}
      >
        <DataTable
          columns={columns}
          data={rows}
          caption={t("table.caption")}
          emptyState={null}
          labels={{
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            pageStatus: (page, total) => t("table.pageStatus", { page, total }),
          }}
        />
      </AsyncSection>
    </PageLayout>
  );
}

/**
 * Скелетон в форме будущей таблицы (П15 канона).
 *
 * Подпись уходит в `aria-label` живой области, а не в видимую строку
 * «Загружаем…»: зрячий видит будущую раскладку, а скринридер — сообщение.
 */
function ProductsSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-field">
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: 8 }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
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
