import { Skeleton } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { MEAL_SLOTS } from "./useMenu";

/**
 * Заглушка загрузки меню в форме будущего содержимого (правило П15 канона).
 *
 * Строка «Загружаем меню…» вместо этого заставляла экран прыгать: сначала одна
 * строка, потом итоги и четыре приёма пищи. Скелетон держит место, и переход
 * между днями не сбивает прицел.
 */
export function MenuSkeleton() {
  const { t } = useTranslation("menu");

  return (
    <div
      className="flex flex-col gap-block"
      role="status"
      aria-busy="true"
      aria-label={t("common:app.loading")}
    >
      <Skeleton className="h-40 w-full rounded-xl" />
      {/* Приёмы пищи — один блок, а не четыре карточки: скелетон повторяет
          реальную раскладку, иначе экран прыгает после загрузки (правило П15). */}
      <Skeleton
        className="w-full rounded-xl"
        style={{ height: `${MEAL_SLOTS.length * 72 + 56}px` }}
      />
    </div>
  );
}
