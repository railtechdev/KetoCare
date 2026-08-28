import { Skeleton } from "@ketocare/ui";

/**
 * Заглушка загрузки в форме будущего содержимого.
 *
 * Строка «Загружаем…» вместо этого заставляла экран прыгать: сначала одна
 * строка, потом шесть блоков. Скелетон держит место, и переход не сбивает
 * прицел.
 */
export function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-touch w-full" />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    </div>
  );
}
