import { Columns, Skeleton, Tiles } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

/**
 * Заглушка загрузки в форме будущего содержимого.
 *
 * Строка «Загружаем…» вместо этого заставляла экран прыгать: сначала одна
 * строка, потом шесть блоков. Скелетон держит место, и переход не сбивает
 * прицел.
 *
 * Раскладку берёт у того же `Columns`, что и сама главная, а не повторяет её
 * классами: пока повторяла, скелетон обещал раскладку `lg:grid-cols-3`, и любая
 * правка главной разводила их молча — экран прыгал ровно в тот момент, ради
 * которого скелетон и существует.
 *
 * Заголовка здесь нет: его рисует `PageLayout` сразу, настоящим текстом, —
 * ждать ответа сервера, чтобы показать слово «Главная», незачем.
 */
export function HomeSkeleton() {
  const { t } = useTranslation("home");

  return (
    <div className="flex flex-col gap-screen" role="status" aria-busy="true">
      <Tiles min="sm">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-touch w-full" />
        ))}
      </Tiles>

      <Columns
        asideLabel={t("aside.label")}
        main={
          <>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </>
        }
        aside={
          <>
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-28 w-full" />
          </>
        }
      />
    </div>
  );
}
