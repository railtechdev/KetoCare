import { RatioBadge } from "@ketocare/ui";
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

  if (recipes.length === 0) {
    return <p className="text-muted-foreground">{t("list.empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {recipes.map((recipe) => (
          <li key={recipe.id}>
            <button
              type="button"
              onClick={() => onOpen(recipe.id)}
              className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-kc-sm"
            >
              <RecipePhoto src={recipe.photo_path} className="h-40 w-full" />

              <span className="flex flex-1 flex-col gap-2 p-4">
                <span className="font-semibold text-foreground">
                  {recipe.title}
                </span>

                <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{t(`categories.${recipe.category}`)}</span>
                  {showStatus && (
                    <span className="rounded-full border border-border px-2 py-0.5">
                      {t(`status.${recipe.status}`)}
                    </span>
                  )}
                </span>

                <span className="mt-auto flex flex-wrap items-center gap-3">
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
                </span>
              </span>
            </button>
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
        <button
          type="button"
          onClick={onShowMore}
          className="min-h-touch w-full max-w-xs rounded-lg border border-border px-4 text-foreground"
        >
          {t("list.showMore")}
        </button>
      )}
    </div>
  );
}
