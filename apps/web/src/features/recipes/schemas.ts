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
  instructions: z.string().trim().min(1),
  ingredients: z
    .array(
      z.object({
        productId: z.string().min(1),
        /** Название хранится в форме только для показа строки состава */
        name: z.string(),
        grams: z.number().positive(),
      }),
    )
    .min(1),
});

export type RecipeFormValues = z.infer<typeof recipeFormSchema>;

/**
 * Числовые поля намеренно не заполнены: выход и число порций редактор задаёт
 * осознанно, а подставленное «правдоподобное» значение легко сохранить не
 * заметив.
 */
export const EMPTY_RECIPE_FORM_VALUES: DefaultValues<RecipeFormValues> = {
  title: "",
  category: "breakfast",
  photoPath: "",
  instructions: "",
  ingredients: [],
};

/** Рецепт с сервера — в значения формы. Названия продуктов приходят отдельно. */
export function toRecipeFormValues(
  recipe: Recipe,
  productNames: Record<string, string>,
  unknownProductLabel: string,
): RecipeFormValues {
  return {
    title: recipe.title,
    category: recipe.category,
    photoPath: recipe.photo_path ?? "",
    yieldG: recipe.yield_g,
    servings: recipe.servings,
    instructions: recipe.instructions,
    ingredients: recipe.ingredients.map((ingredient) => ({
      productId: ingredient.product_id,
      name: productNames[ingredient.product_id] ?? unknownProductLabel,
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
