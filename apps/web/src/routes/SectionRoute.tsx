import { Skeleton } from "@ketocare/ui";
import { useParams } from "@tanstack/react-router";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../features/auth/useSession";
import { SectionPlaceholder } from "./SectionPlaceholder";
import { SECTION_SCREENS } from "./sections";

/**
 * Компонент маршрута раздела: сопоставляет параметр пути с экраном.
 *
 * Экраны грузятся по требованию (`lazy` в `sections.tsx`), поэтому переход в
 * раздел означает загрузку его чанка. Пока чанк едет, показывается скелетон в
 * форме будущей страницы — заголовок и блок, — а не пустота и не «Загружаем…»:
 * подмена содержимого на строку заставляет экран прыгать (правило П15 канона).
 */
export function SectionRoute() {
  const { section } = useParams({ from: "/app/$section" });
  const { session } = useSession();

  const screen = SECTION_SCREENS[section];
  if (!screen) return <SectionPlaceholder section={section} />;

  return (
    <Suspense fallback={<SectionSkeleton />}>{screen(session?.role)}</Suspense>
  );
}

function SectionSkeleton() {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("states.loadingSection")}
      // Без предела ширины: ширина — роль страницы, и её задаёт `PageLayout`
      // того экрана, который сейчас едет (правило П34). Скелетон не знает, у
      // какого экрана какая роль, и подставлять свою было бы второй системой
      // ширин.
      className="flex flex-col gap-screen"
    >
      <div className="flex flex-col gap-block">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}
