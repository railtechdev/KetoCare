import { Skeleton, cn } from "@ketocare/ui";

/**
 * Скелетоны кабинета врача (правило П15 UI-канона).
 *
 * Загрузка показывается формой будущего содержимого, а не строкой «Загружаем…»:
 * страница не прыгает, когда данные приходят. Подпись остаётся — она уходит в
 * `aria-label` живой области, иначе для скринридера загрузка выглядела бы как
 * пустой экран.
 */
export function TableSkeleton({
  label,
  rows = 4,
  className,
}: {
  /** Что именно грузится — для скринридера */
  label: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn("flex flex-col gap-field", className)}
    >
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

/** Скелетон абзаца или списка «подпись — значение». */
export function LinesSkeleton({
  label,
  lines = 3,
  className,
}: {
  label: string;
  lines?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn("flex flex-col gap-field", className)}
    >
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-5", index === lines - 1 ? "w-1/2" : "w-full")}
        />
      ))}
    </div>
  );
}

/** Скелетон списка карточек — записи дневника, заметки. */
export function CardsSkeleton({
  label,
  cards = 3,
  className,
}: {
  label: string;
  cards?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn("flex flex-col gap-block", className)}
    >
      {Array.from({ length: cards }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}
