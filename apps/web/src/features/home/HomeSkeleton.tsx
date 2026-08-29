import { Skeleton } from "@ketocare/ui";

/**
 * Заглушка загрузки в форме будущего содержимого.
 *
 * Строка «Загружаем…» вместо этого заставляла экран прыгать: сначала одна
 * строка, потом шесть блоков. Скелетон держит место, и переход не сбивает
 * прицел.
 *
 * Заголовка здесь нет: его рисует `PageLayout` сразу, настоящим текстом, —
 * ждать ответа сервера, чтобы показать слово «Главная», незачем.
 */
export function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-screen" role="status" aria-busy="true">
      <div className="grid gap-block sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-touch w-full" />
        ))}
      </div>

      <div className="grid gap-block lg:grid-cols-3">
        <div className="flex flex-col gap-block lg:col-span-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <div className="flex flex-col gap-block">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    </div>
  );
}
