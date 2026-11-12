import { Button, formatKcal, formatRatio } from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";
import { incomingDish } from "../calculator/incomingItem";
import { AddToMenuPopover } from "./AddToMenu";
import type { MenuDish } from "./useAddToMenu";
import { useCustomDishes } from "../dishes/useCustomDishes";
import { useRecipeSearch } from "../recipes/useRecipes";

/** Сколько вариантов показать: выбирают глазами, а не листают. */
const LIMIT = 6;

interface Pick {
  key: string;
  title: string;
  kcal: number;
  ratio: number | null;
  link: { item: string; section: "calculator" | "recipes" };
  dish: MenuDish;
}

/**
 * «Подобрать блюдо на остаток» (просьба диетолога от 21.10.2026: «найди мне
 * еду на … ккал»). Блюда ребёнка и рецепты базы, которые укладываются в
 * оставшиеся калории дня, ближайшие к остатку — первыми. Само ничего не
 * добавляет, но рядом с каждым — «В приём…»: найденное блюдо ставится в этот
 * день сразу, без второго поиска в «Добавить блюдо» (раньше подбор был
 * тупиком — находил, но не ставил).
 */
export function RemainingPicks({
  patientId,
  date,
  remainingKcal,
}: {
  patientId: string;
  /** День, на остаток которого подбирают: в него блюдо и ставится. */
  date: string;
  remainingKcal: number;
}) {
  const { t } = useTranslation("menu");
  const [open, setOpen] = useState(false);
  const dishes = useCustomDishes(open ? patientId : null);
  const recipes = useRecipeSearch(
    { q: "", category: "", ratioMin: "", ratioMax: "", limit: 200 },
    open,
  );

  const picks: Pick[] = [
    ...(dishes.data ?? []).flatMap((dish) =>
      dish.computed == null
        ? []
        : [
            {
              key: `dish:${dish.id}`,
              title: dish.title,
              kcal: dish.computed.kcal,
              ratio: dish.computed.ratio ?? null,
              link: {
                item: incomingDish(dish.id),
                section: "calculator" as const,
              },
              dish: {
                kind: "custom" as const,
                id: dish.id,
                title: dish.title,
              },
            },
          ],
    ),
    ...(recipes.data?.items ?? []).flatMap((recipe) =>
      recipe.per_portion == null
        ? []
        : [
            {
              key: `recipe:${recipe.id}`,
              title: recipe.title,
              kcal: recipe.per_portion.kcal,
              ratio: recipe.per_portion.ratio ?? null,
              link: { item: recipe.id, section: "recipes" as const },
              dish: {
                kind: "recipe" as const,
                id: recipe.id,
                title: recipe.title,
              },
            },
          ],
    ),
  ]
    .filter((pick) => pick.kcal > 0 && pick.kcal <= remainingKcal)
    .sort((a, b) => b.kcal - a.kcal)
    .slice(0, LIMIT);

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        className="min-h-touch self-start"
        onClick={() => setOpen(true)}
      >
        {t("remaining.find", { kcal: formatKcal(remainingKcal) })}
      </Button>
    );
  }

  const loading = dishes.isPending || recipes.isPending;

  return (
    <div className="flex flex-col gap-field">
      <p className="m-0 text-sm font-medium">
        {t("remaining.title", { kcal: formatKcal(remainingKcal) })}
      </p>
      {loading ? (
        <p className="m-0 text-sm text-muted-foreground" role="status">
          {t("remaining.loading")}
        </p>
      ) : picks.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          {t("remaining.none")}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {picks.map((pick) => (
            <li key={pick.key} className="flex flex-wrap items-center gap-x-1">
              <SectionLink
                section={pick.link.section}
                item={pick.link.item}
                className="flex min-h-touch min-w-0 flex-1 flex-wrap items-center justify-between gap-x-field rounded-lg px-2 text-sm hover:bg-accent"
              >
                <span className="font-medium">{pick.title}</span>
                <span className="text-muted-foreground tabular-nums">
                  {pick.ratio === null
                    ? t("remaining.kcal", { kcal: formatKcal(pick.kcal) })
                    : t("remaining.kcalRatio", {
                        kcal: formatKcal(pick.kcal),
                        ratio: formatRatio(pick.ratio),
                      })}
                </span>
              </SectionLink>
              <AddToMenuPopover
                patientId={patientId}
                dish={pick.dish}
                date={date}
                label={t("remaining.addTo")}
                ariaLabel={t("remaining.addToFor", { title: pick.title })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
