import type { DefaultValues } from "react-hook-form";
import { z } from "zod";

import { RECIPE_CATEGORIES, type Recipe, type RecipeWriteBody } from "./types";

/**
 * Схема формы рецепта (раздел 3 ТЗ: react-hook-form + zod).
 *
 * Проверяет только заполненность и знак чисел. Предельные значения (длина
 * названия, максимум порций и граммов) остаются за сервером: клиентская
 * проверка — подсказка пользователю, а её копия предельных значений со
 * временем разошлась бы со схемой API.
 */
export const recipeFormSchema = z.object({
  title: z.string().trim().min(1),
  category: z.enum(RECIPE_CATEGORIES),
  photoPath: z.string().trim(),
  yieldG: z.number().positive(),
  servings: z.number().int().positive(),
  // Как готовить — необязательно: рецепт из базы клиники часто приходит одним
  // составом, а требование текста заставляло вписывать «см. выше», лишь бы
  // сохранить (аудит 2026-11, «Рецепт»).
  instructions: z.string().trim(),
  ingredients: z
    .array(
      z.object({
        productId: z.string().min(1),
        grams: z.number().positive(),
      }),
    )
    .min(1),
});

export type RecipeFormValues = z.infer<typeof recipeFormSchema>;

/**
 * Число порций и категория не заполнены: их редактор задаёт осознанно, а
 * подставленное «правдоподобное» значение легко сохранить не заметив — так
 * каждый рецепт и становился «Завтраком». Выход подставляет форма — суммой
 * граммов состава, и он остаётся правимым (`RecipeForm`).
 */
export const EMPTY_RECIPE_FORM_VALUES: DefaultValues<RecipeFormValues> = {
  title: "",
  photoPath: "",
  instructions: "",
  ingredients: [],
};

/** Рецепт с сервера — в значения формы. Названия продуктов приходят отдельно. */
/**
 * Выход по умолчанию — сумма граммов состава: блюдо весит столько, сколько в
 * него положили, пока его не уварили. Округление до десятой — точность поля.
 */
export function compositionGrams(
  ingredients: readonly ({ grams?: number } | undefined)[],
): number {
  const total = ingredients.reduce(
    (sum, item) =>
      sum +
      (item?.grams !== undefined &&
      Number.isFinite(item.grams) &&
      item.grams > 0
        ? item.grams
        : 0),
    0,
  );
  return Math.round(total * 10) / 10;
}

export function toRecipeFormValues(recipe: Recipe): RecipeFormValues {
  return {
    title: recipe.title,
    category: recipe.category,
    photoPath: recipe.photo_path ?? "",
    yieldG: recipe.yield_g,
    servings: recipe.servings,
    instructions: recipe.instructions,
    ingredients: recipe.ingredients.map((ingredient) => ({
      productId: ingredient.product_id,
      grams: ingredient.grams,
    })),
  };
}

/**
 * Значения формы — в тело `POST/PUT /recipes`.
 *
 * Ни показатели, ни пищевая ценность продуктов не отправляются: состав сервер
 * пересчитывает ядром по `product_id`, иначе рецепт можно было бы «посчитать»
 * по выдуманным макронутриентам.
 */
export function toRecipeBody(values: RecipeFormValues): RecipeWriteBody {
  const photoPath = values.photoPath.trim();

  return {
    title: values.title.trim(),
    category: values.category,
    photo_path: photoPath === "" ? null : photoPath,
    yield_g: values.yieldG,
    servings: values.servings,
    instructions: values.instructions.trim(),
    ingredients: values.ingredients.map((ingredient) => ({
      product_id: ingredient.productId,
      grams: ingredient.grams,
    })),
  };
}
