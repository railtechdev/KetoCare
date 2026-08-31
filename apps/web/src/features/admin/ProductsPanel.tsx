import {
  AsyncSection,
  Button,
  DataTable,
  EmptyState,
  Section,
  toast,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { Apple, Plus, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";

import { useSectionItem } from "../../routes/useSectionTab";
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

interface Props {
  /**
   * Импорт CSV и история правок доступны только администратору: обе ручки
   * закрыты `require_roles(ADMIN)` на сервере. Диетолог видит тот же список и
   * ту же форму, но без этих двух дверей — иначе он упирался бы в 403.
   */
  canImport?: boolean;
  /**
   * `tab` — панель внутри вкладок администрирования, заголовок свой (`h2`).
   * `screen` — самостоятельный экран, заголовок даёт `PageLayout`, и второй
   * такой же был бы дублем (правило П23 канона).
   */
  chrome?: "tab" | "screen";
}

/** Значение `?item=`, означающее заведение новой позиции. */
const NEW_ITEM = "new";
/** Значение `?item=`, означающее экран импорта. */
const IMPORT_ITEM = "import";

/**
 * Справочник продуктов администратора (раздел 8.3 ТЗ, «Админ / Продукты»).
 *
 * Список, карточка позиции и импорт живут в одном разделе маршрута:
 * `/app/$section` не знает о вложенных путях. Но что именно открыто, хранится
 * в адресе (`?item=`), а не в состоянии экрана: правило П1 канона требует
 * адрес у каждого объекта второго уровня, и докстрока `FormSheet` прямо
 * относит продукт к тому, что остаётся отдельным экраном, а не панелью.
 *
 * До этого администратор, правивший позицию, не мог ни переслать ссылку
 * коллеге, ни обновить страницу: F5 возвращал в список, а «Назад» браузера
 * уводил из раздела целиком.
 */
export function ProductsPanel({
  canImport = true,
  chrome = "tab",
}: Props = {}) {
  const { t } = useTranslation("admin");

  const [filters, setFilters] = useState<ProductFilters>(EMPTY_PRODUCT_FILTERS);
  const [item, setItem] = useSectionItem();

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
            onClick={() => setItem(row.original.id)}
          >
            {t("products.edit")}
          </Button>
        ),
      },
    ],
    [t, categoryNames, setItem],
  );

  // Проверка и по адресу тоже: `?item=import` вводится руками, и без неё
  // диетолог попал бы на экран, чья ручка ответит ему 403.
  if (item === IMPORT_ITEM && canImport) {
    return <ProductImportPanel onDone={() => setItem(undefined)} />;
  }

  if (item !== undefined) {
    // Позиция ищется в уже загруженном списке. Прямой переход по ссылке на
    // строку, которой нет в текущей выборке (другая страница, другой фильтр),
    // отдаёт `undefined` — и открывается форма заведения. Полноценное чтение
    // позиции по идентификатору требует отдельной ручки и вложенного маршрута
    // (открытая тема в CLAUDE.md); до неё ссылка работает в пределах выборки.
    const editing =
      item === NEW_ITEM ? null : (rows.find((p) => p.id === item) ?? null);

    return (
      <ProductEditor
        product={editing}
        categories={categories.data ?? []}
        onSaved={(product) => {
          setItem(undefined);
          toast.success(t("products.saved", { name: product.name_ru }));
        }}
        onCancel={() => setItem(undefined)}
        // История доступна диетологу наравне с администратором: она читается
        // из `product_revisions`, а не из журнала аудита, закрытого ролью admin.
        showHistory
      />
    );
  }

  const actions = (
    <>
      <Button type="button" onClick={() => setItem(NEW_ITEM)}>
        <Plus aria-hidden="true" />
        {t("products.create")}
      </Button>
      {canImport && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setItem(IMPORT_ITEM)}
        >
          <Upload aria-hidden="true" />
          {t("products.importCsv")}
        </Button>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-block">
      {chrome === "tab" ? (
        <SubPageHeader
          title={t("products.title")}
          intro={t("products.intro")}
          actions={actions}
        />
      ) : (
        <div className="flex flex-wrap gap-field">{actions}</div>
      )}

      {/* Панель фильтров — блок экрана, а значит `Section` со скрытым
          заголовком (правило П23). `fieldset` остаётся внутри форм, где
          группирует поля общей подписью, — как в уже приведённых к канону
          экранах родителя. */}
      <Section
        title={t("products.filters.legend")}
        titleHidden
        density="compact"
        contentClassName="flex-row flex-wrap items-end gap-block"
      >
        <div className="min-w-56 flex-1 sm:max-w-md">
          <Field
            id="admin-product-search"
            width="wide"
            type="search"
            label={t("products.filters.search")}
            placeholder={t("products.filters.searchPlaceholder")}
            value={filters.q}
            onChange={(event) =>
              setFilters((current) => ({ ...current, q: event.target.value }))
            }
          />
        </div>

        {/* Без этого флажка снятие «активен» было необратимым: позиция
            исчезала из выдачи для всех, включая того, кто её вывел. */}
        <label className="flex min-h-touch items-center gap-field text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={filters.includeInactive}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                includeInactive: event.target.checked,
              }))
            }
          />
          {t("products.filters.includeInactive")}
        </label>

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
      </Section>

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
              <Button type="button" onClick={() => setItem(NEW_ITEM)}>
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
