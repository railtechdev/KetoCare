import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  RatioBadge,
  Skeleton,
  Tiles,
  formatKcal,
} from "@ketocare/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { CookingPot, Plus, SearchX } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { RecipePhoto } from "./RecipePhoto";
import type { Recipe, RecipeView } from "./types";

interface Props {
  /** Строки — для работы с базой, карточки — для выбора глазами по фото */
  view: RecipeView;
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
    <div className="flex flex-col gap-section">
      <p role="status" className="sr-only">
        {t("list.loading")}
      </p>

      <Tiles as="ul" min="sm" columns="fill" aria-hidden="true">
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
      </Tiles>
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
 * Выдача рецептов строками или карточками.
 *
 * Карточки — для родителя: он выбирает еду глазами, по фото и названию.
 * Строки — для диетолога (замечание 17.11.2026): база клиники почти вся без
 * фото, и карточки с серыми заглушками показывали четыре рецепта на экран там,
 * где строки показывают двадцать. «Показать ещё» и счётчик у обоих видов общие.
 */
export function RecipeList({
  view,
  recipes,
  total,
  onOpen,
  onShowMore,
  showStatus,
}: Props) {
  const { t } = useTranslation("recipes");

  return (
    <div className="flex flex-col gap-section">
      {view === "list" ? (
        <RecipeTable
          recipes={recipes}
          onOpen={onOpen}
          showStatus={showStatus}
        />
      ) : (
        <RecipeTiles
          recipes={recipes}
          onOpen={onOpen}
          showStatus={showStatus}
        />
      )}

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

/** Калорийность на порцию, как в Mini App и как считается день. */
function KcalText({ recipe }: { recipe: Recipe }) {
  const { t } = useTranslation("recipes");
  // Число всего выхода без подписи семья сравнивала с порцией в приложении и
  // видела «другие» калории (аудит расчётов 13.11.2026).
  return recipe.per_portion
    ? t("card.kcalPerPortion", { value: formatKcal(recipe.per_portion.kcal) })
    : recipe.computed
      ? t("card.kcalWhole", { value: formatKcal(recipe.computed.kcal) })
      : t("card.noComputed");
}

function RecipeTable({
  recipes,
  onOpen,
  showStatus,
}: {
  recipes: Recipe[];
  onOpen: (recipeId: string) => void;
  showStatus: boolean;
}) {
  const { t } = useTranslation("recipes");

  const columns = useMemo<ColumnDef<Recipe, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: t("table.title"),
        // Название — настоящая кнопка: строка открывается и с клавиатуры, и
        // скринридер слышит, что именно откроется.
        cell: ({ row }) => (
          <Button
            type="button"
            variant="link"
            className="h-auto min-h-touch p-0 text-left whitespace-normal"
            onClick={() => onOpen(row.original.id)}
          >
            {row.original.title}
          </Button>
        ),
      },
      {
        accessorKey: "category",
        header: t("table.category"),
        cell: ({ row }) => t(`categories.${row.original.category}`),
      },
      ...(showStatus
        ? [
            {
              accessorKey: "status",
              header: t("table.status"),
              cell: ({ row }) => (
                <Badge variant="outline">
                  {t(`status.${row.original.status}`)}
                </Badge>
              ),
            } satisfies ColumnDef<Recipe, unknown>,
          ]
        : []),
      {
        id: "ratio",
        accessorFn: (recipe) => recipe.computed?.ratio ?? null,
        header: t("table.ratio"),
        sortUndefined: "last",
        // Вердикта о допуске нет и здесь: соотношение рецепта — его
        // характеристика, соответствие назначению зависит от ребёнка.
        cell: ({ row }) => (
          <RatioBadge ratio={row.original.computed?.ratio ?? null} />
        ),
      },
      {
        id: "kcal",
        accessorFn: (recipe) =>
          recipe.per_portion?.kcal ?? recipe.computed?.kcal ?? null,
        header: t("table.kcal"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            <KcalText recipe={row.original} />
          </span>
        ),
      },
    ],
    [onOpen, showStatus, t],
  );

  return (
    <DataTable
      columns={columns}
      data={recipes}
      // Страницы — «Показать ещё» под таблицей, как у карточек: второй способ
      // листать ту же выдачу запутал бы.
      pageSize={0}
      caption={t("table.caption")}
      emptyState={null}
      labels={{
        previousPage: t("table.previousPage"),
        nextPage: t("table.nextPage"),
        pageStatus: (page, total) => t("table.pageStatus", { page, total }),
      }}
    />
  );
}

/** Карточки с фото: родитель выбирает еду глазами, а не по столбцам чисел. */
function RecipeTiles({
  recipes,
  onOpen,
  showStatus,
}: {
  recipes: Recipe[];
  onOpen: (recipeId: string) => void;
  showStatus: boolean;
}) {
  const { t } = useTranslation("recipes");

  return (
    <Tiles as="ul" min="sm" columns="fill">
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
            <RecipePhoto
              recipeId={recipe.id}
              photoPath={recipe.photo_path}
              className="h-40 w-full"
            />

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

              <p className="m-0 mt-auto flex flex-wrap items-center gap-section">
                {/* Вердикт о допуске не передаётся: соотношение рецепта — его
                      характеристика, а соответствие назначению зависит от
                      конкретного ребёнка и считается сервером в меню. */}
                <RatioBadge ratio={recipe.computed?.ratio ?? null} />
                <span className="text-sm text-muted-foreground tabular-nums">
                  <KcalText recipe={recipe} />
                </span>
              </p>
            </div>
          </Card>
        </li>
      ))}
    </Tiles>
  );
}
