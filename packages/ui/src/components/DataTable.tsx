import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useState, type ReactNode } from "react";

import { cn } from "../lib/cn";

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  /** Показывается вместо таблицы, когда строк нет (раздел 8.2 ТЗ: пустое состояние) */
  emptyState: ReactNode;
  /** Подписи — снаружи: пакет не зависит от i18n приложения */
  labels: DataTableLabels;
  /** 0 отключает постраничность — вся выборка на экране */
  pageSize?: number;
  /**
   * Страницы считает сервер.
   *
   * Нужно там, где выборка не помещается в один запрос: клиентская
   * постраничность делит то, что уже пришло, и на «первых 200 строках из 3000»
   * молча выдаёт часть за целое — человек видит «страница 10 из 10» и уверен,
   * что дочитал справочник до конца.
   */
  serverPagination?: ServerPagination;
  /** Доступное описание таблицы для скринридера */
  caption: string;
  /** Сводка числа записей в подвале таблицы (например, «Найдено записей: 42») */
  footerMeta?: ReactNode;
  className?: string;
}

export interface ServerPagination {
  /** Номер страницы с нуля */
  pageIndex: number;
  /** Сколько страниц всего — по `total` из ответа сервера */
  pageCount: number;
  onPageChange: (pageIndex: number) => void;
}

export interface DataTableLabels {
  previousPage: string;
  nextPage: string;
  /** Например: «Страница {{page}} из {{total}}» — подстановку делает вызывающий */
  pageStatus: (page: number, totalPages: number) => string;
}

/**
 * Таблица над TanStack Table (раздел 8.2 ТЗ: сортировка, пагинация, пустое состояние).
 *
 * Подписи и пустое состояние приходят пропами, а не берутся из i18n: пакет
 * `packages/ui` общий для web и miniapp, и своего словаря у него нет — иначе
 * строки пришлось бы дублировать в двух приложениях.
 */
export function DataTable<TData>({
  columns,
  data,
  emptyState,
  labels,
  pageSize = 20,
  serverPagination,
  caption,
  footerMeta,
  className,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // Сервер уже отдал ровно одну страницу — делить её ещё раз нечем.
    ...(serverPagination === undefined && pageSize > 0
      ? {
          getPaginationRowModel: getPaginationRowModel(),
          initialState: { pagination: { pageIndex: 0, pageSize } },
        }
      : {}),
  });

  if (data.length === 0) {
    return (
      <div className={cn("text-muted-foreground", className)}>{emptyState}</div>
    );
  }

  const pageCount = serverPagination?.pageCount ?? table.getPageCount();
  const pageIndex =
    serverPagination?.pageIndex ?? table.getState().pagination.pageIndex;
  const canPrevious =
    serverPagination === undefined ? table.getCanPreviousPage() : pageIndex > 0;
  const canNext =
    serverPagination === undefined
      ? table.getCanNextPage()
      : pageIndex + 1 < pageCount;
  const goTo = (next: number) =>
    serverPagination === undefined
      ? table.setPageIndex(next)
      : serverPagination.onPageChange(next);
  const showPagination =
    serverPagination !== undefined
      ? pageCount > 1
      : pageSize > 0 && pageCount > 1;
  const showFooter = showPagination || Boolean(footerMeta);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-kc-sm",
        className,
      )}
    >
      {/* Широкая таблица прокручивается внутри себя, а не растягивает страницу */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="border-b border-border bg-muted/45"
              >
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const direction = header.column.getIsSorted();
                  const isStickyRight = header.column.id === "actions";

                  return (
                    <th
                      key={header.id}
                      scope="col"
                      // aria-sort объявляет направление сортировки скринридеру:
                      // стрелка в заголовке видна только зрячим.
                      aria-sort={
                        direction === "asc"
                          ? "ascending"
                          : direction === "desc"
                            ? "descending"
                            : undefined
                      }
                      className={cn(
                        "px-3.5 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase",
                        isStickyRight &&
                          "sticky right-0 z-10 border-l border-border/60 bg-muted/95 backdrop-blur-xs",
                      )}
                    >
                      {sortable ? (
                        // Своего aria-label у кнопки нет: её доступным именем
                        // становится заголовок столбца, иначе скринридер услышал
                        // бы одинаковое «сортировать» у всех столбцов и не понял,
                        // какой. Направление объявляет aria-sort на ячейке.
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="flex min-h-touch items-center gap-1 text-left font-semibold tracking-wide uppercase hover:text-foreground"
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          <span aria-hidden="true">
                            {direction === "asc"
                              ? "↑"
                              : direction === "desc"
                                ? "↓"
                                : ""}
                          </span>
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody className="divide-y divide-border bg-card">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="group bg-card transition-colors hover:bg-muted/35"
              >
                {row.getVisibleCells().map((cell) => {
                  const isStickyRight = cell.column.id === "actions";
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "px-3.5 py-2.5 align-middle",
                        isStickyRight &&
                          "sticky right-0 z-10 border-l border-border/60 bg-card/95 backdrop-blur-xs group-hover:bg-muted/85",
                      )}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showFooter && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-2.5">
          {footerMeta ? (
            <div className="text-sm text-muted-foreground tabular-nums">
              {footerMeta}
            </div>
          ) : (
            <span />
          )}
          {showPagination && (
            <nav className="flex items-center gap-2.5" aria-label={caption}>
              <button
                type="button"
                onClick={() => goTo(pageIndex - 1)}
                disabled={!canPrevious}
                className="min-h-touch rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50"
              >
                {labels.previousPage}
              </button>
              <span
                role="status"
                className="px-1 text-sm font-medium text-muted-foreground tabular-nums"
              >
                {labels.pageStatus(pageIndex + 1, pageCount)}
              </span>
              <button
                type="button"
                onClick={() => goTo(pageIndex + 1)}
                disabled={!canNext}
                className="min-h-touch rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50"
              >
                {labels.nextPage}
              </button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
