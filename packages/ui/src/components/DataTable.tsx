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

  return (
    <div className={className}>
      {/* Широкая таблица прокручивается внутри себя, а не растягивает страницу */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const direction = header.column.getIsSorted();

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
                      className="px-3 py-2 text-sm font-semibold text-muted-foreground"
                    >
                      {sortable ? (
                        // Своего aria-label у кнопки нет: её доступным именем
                        // становится заголовок столбца, иначе скринридер услышал
                        // бы одинаковое «сортировать» у всех столбцов и не понял,
                        // какой. Направление объявляет aria-sort на ячейке.
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="flex min-h-touch items-center gap-1 text-left"
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

          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showPagination && (
        <nav className="mt-3 flex items-center gap-3" aria-label={caption}>
          <button
            type="button"
            onClick={() => goTo(pageIndex - 1)}
            disabled={!canPrevious}
            className="min-h-touch rounded-lg border border-border px-3 disabled:opacity-50"
          >
            {labels.previousPage}
          </button>
          <span
            role="status"
            className="text-sm text-muted-foreground tabular-nums"
          >
            {labels.pageStatus(pageIndex + 1, pageCount)}
          </span>
          <button
            type="button"
            onClick={() => goTo(pageIndex + 1)}
            disabled={!canNext}
            className="min-h-touch rounded-lg border border-border px-3 disabled:opacity-50"
          >
            {labels.nextPage}
          </button>
        </nav>
      )}
    </div>
  );
}
