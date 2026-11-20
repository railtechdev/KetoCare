import { WarningBanner, cn, formatMass } from "@ketocare/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { productName, useProductNames } from "./useRecipes";

/**
 * Строка «что взвесить»: продукт слева, граммы справа — всегда в своём столбце.
 *
 * Строка не переносится целиком: длинное имя переносится внутри левой
 * колонки, а пометки («приправа, не учитывается», «в архиве») стоят под
 * именем отдельной строкой. Прежде строка была `flex-wrap`, и на 360 px
 * «Перец чёрный молотый приправа, не учитывается» выталкивал граммы на
 * следующую строку к левому краю. Граммы — число, по которому родитель
 * взвешивает у плиты, — основным цветом и обычным кеглем, а не серым мелким.
 */
export function WeighRow({
  name,
  notes,
  grams,
}: {
  name: ReactNode;
  notes?: ReactNode;
  grams: string;
}) {
  return (
    <li className="flex items-baseline justify-between gap-field">
      <span className="flex min-w-0 flex-1 flex-col break-words">
        <span>{name}</span>
        {notes}
      </span>
      <span className="shrink-0 text-base text-foreground tabular-nums">
        {grams}
      </span>
    </li>
  );
}

/** Пометка под именем продукта в строке «что взвесить». */
export function WeighNote({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "warning";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "text-sm",
        tone === "warning" ? "text-warning-strong" : "text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Состав рецепта или блюда ребёнка граммами, как он сохранён на сервере.
 *
 * Один на карточку рецепта и карточку блюда ребёнка: по обеим готовят, и
 * продукт, выведенный в архив, обязан быть назван в обеих — показатели
 * посчитаны в том числе по нему, а выводят продукт обычно потому, что его
 * числа оказались неверными. Имена — по карточкам продуктов (хранятся только
 * `product_id`); граммы видны всегда, даже пока имена в пути. Приправа помечена
 * по списку из сохранённого расчёта, а не по живой отметке продукта (ADR-0054).
 */
export function ProductComposition({
  ingredients,
  uncountedIds,
}: {
  ingredients: readonly { product_id: string; grams: number }[];
  uncountedIds: readonly string[];
}) {
  const { t } = useTranslation();
  const names = useProductNames(
    ingredients.map((ingredient) => ingredient.product_id),
  );
  const uncounted = new Set(uncountedIds);

  if (ingredients.length === 0) {
    return (
      <p className="m-0 text-muted-foreground">{t("recipes.noComposition")}</p>
    );
  }

  return (
    <div className="flex flex-col gap-field">
      {Object.keys(names.withdrawn).length > 0 && (
        <WarningBanner level="warning" title={t("recipes.withdrawnTitle")}>
          {t("recipes.withdrawnBody", {
            list: Object.values(names.withdrawn).join(", "),
          })}
        </WarningBanner>
      )}

      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {ingredients.map((ingredient) => (
          <WeighRow
            key={ingredient.product_id}
            name={productName(names.stateOf(ingredient.product_id), t)}
            notes={
              <>
                {names.withdrawn[ingredient.product_id] !== undefined && (
                  <WeighNote tone="warning">{t("recipes.withdrawn")}</WeighNote>
                )}
                {uncounted.has(ingredient.product_id) && (
                  <WeighNote>{t("recipes.uncounted")}</WeighNote>
                )}
              </>
            }
            grams={t("recipes.grams", { value: formatMass(ingredient.grams) })}
          />
        ))}
      </ul>
    </div>
  );
}
