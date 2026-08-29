import { Skeleton } from "@ketocare/ui";

/**
 * Скелетон таблицы: заголовок и несколько строк будущей выдачи.
 *
 * Правило П15 UI-канона: на время загрузки показывается форма будущего
 * содержимого, а не строка «Загружаем…». Подпись остаётся — но только для
 * скринридера: он объявляет, что экран занят, пока зрячий видит каркас.
 */
export function TableSkeleton({
  label,
  rows = 5,
  columns = 4,
}: {
  /** Что именно загружается — объявляется скринридеру */
  label: string;
  rows?: number;
  columns?: number;
}) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-field">
      <span className="sr-only">{label}</span>

      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-block">
          {Array.from({ length: columns }, (_, cell) => (
            <Skeleton key={cell} className="h-6 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
