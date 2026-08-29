import {
  Badge,
  Button,
  Card,
  EmptyState,
  RatioBadge,
  Skeleton,
} from "@ketocare/ui";
import { CookingPot, Plus, SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";

import { RecipePhoto } from "./RecipePhoto";
import type { Recipe } from "./types";

interface Props {
  recipes: Recipe[];
  total: number;
  onOpen: (recipeId: string) => void;
  onShowMore: () => void;
  /** Статус рецепта показывается только тем, кто его меняет */
  showStatus: boolean;
}

interface EmptyProps {
  /** Задан хоть один фильтр: пустая выдача означает «не нашлось», а не «база пуста» */
  filtersActive: boolean;
  onResetFilters: () => void;
  /** Создание рецепта; у родителя и врача его нет (раздел 5.3 ТЗ) */
  onCreate?: () => void;
}

/** Скелетон выдачи: та же сетка карточек, что и у готового списка. */
export function RecipeListSkeleton() {
  const { t } = useTranslation("recipes");

  return (
    <div className="flex flex-col gap-block">
      <p role="status" className="sr-only">
        {t("list.loading")}
      </p>

      <ul
        aria-hidden="true"
        className="m-0 grid list-none gap-block p-0 sm:grid-cols-2 lg:grid-cols-3"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index}>
            <Card className="h-full gap-0 overflow-hidden py-0">
              <Skeleton className="h-40 w-full rounded-none" />
              <div className="flex flex-col gap-field p-4">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-6 w-1/2" />
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Пустая выдача рецептов.
 *
 * Отдельный компонент, а не ветка внутри списка: пустым состоянием
 * распоряжается `AsyncSection` — он же решает, что показать при ошибке и
 * загрузке. Оставь ветку в списке — пустое состояние рисовалось бы дважды.
 */
export function RecipeListEmpty({
  filtersActive,
  onResetFilters,
  onCreate,
}: EmptyProps) {
  const { t } = useTranslation("recipes");

  return filtersActive ? (
    <EmptyState
      icon={SearchX}
      title={t("list.notFoundTitle")}
      description={t("list.notFoundBody")}
      action={
        <Button
          type="button"
          variant="outline"
          className="min-h-touch"
          onClick={onResetFilters}
        >
          {t("filters.reset")}
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={CookingPot}
      title={t("list.emptyTitle")}
      description={t("list.emptyBody")}
      action={
        onCreate && (
          <Button type="button" className="min-h-touch" onClick={onCreate}>
            <Plus aria-hidden="true" />
            {t("actions.create")}
          </Button>
        )
      }
    />
  );
}

/**
 * Список рецептов карточками.
 *
 * Карточки, а не таблица: родитель выбирает еду глазами — по фото и названию,
 * а не сравнивает столбцы чисел.
 */
export function RecipeList({
  recipes,
  total,
  onOpen,
  onShowMore,
  showStatus,
}: Props) {
  const { t } = useTranslation("recipes");

  return (
    <div className="flex flex-col gap-block">
      <ul className="m-0 grid list-none gap-block p-0 sm:grid-cols-2 lg:grid-cols-3">
        {recipes.map((recipe) => (
          <li key={recipe.id}>
            {/* Кликабельна вся карточка, но нажимается настоящая кнопка с
                названием: её область растянута на карточку через ::after.
                Так у клика остаётся понятное имя для скринридера, а фокус
                виден на всей карточке.

                Фокус карточки — outline, а не ring: ring рисуется тенью, а
                тени в режиме высокой контрастности Windows не показываются, и
                фокус там становился невидимым. Outline система перекрашивает,
                но не убирает. */}
            <Card className="relative h-full gap-0 overflow-hidden py-0 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
              <RecipePhoto src={recipe.photo_path} className="h-40 w-full" />

              <div className="flex flex-1 flex-col gap-field p-4">
                <h2 className="m-0 text-card-title font-semibold text-foreground">
                  <button
                    type="button"
                    onClick={() => onOpen(recipe.id)}
                    className="text-left outline-none after:absolute after:inset-0"
                  >
                    {recipe.title}
                  </button>
                </h2>

                <p className="m-0 flex flex-wrap items-center gap-field text-sm text-muted-foreground">
                  <span>{t(`categories.${recipe.category}`)}</span>
                  {showStatus && (
                    <Badge variant="outline">
                      {t(`status.${recipe.status}`)}
                    </Badge>
                  )}
                </p>

                <p className="m-0 mt-auto flex flex-wrap items-center gap-block">
                  {/* Вердикт о допуске не передаётся: соотношение рецепта — его
                      характеристика, а соответствие назначению зависит от
                      конкретного ребёнка и считается сервером в меню. */}
                  <RatioBadge ratio={recipe.computed?.ratio ?? null} />
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {recipe.computed
                      ? t("card.kcal", {
                          value: recipe.computed.kcal.toFixed(0),
                        })
                      : t("card.noComputed")}
                  </span>
                </p>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <p
        role="status"
        className="m-0 text-sm text-muted-foreground tabular-nums"
      >
        {t("list.shown", { shown: recipes.length, total })}
      </p>

      {recipes.length < total && (
        <Button
          type="button"
          variant="outline"
          className="min-h-touch w-full max-w-xs"
          onClick={onShowMore}
        >
          {t("list.showMore")}
        </Button>
      )}
    </div>
  );
}
