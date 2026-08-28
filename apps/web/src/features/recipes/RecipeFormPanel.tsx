import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { RecipeForm } from "./RecipeForm";
import {
  EMPTY_RECIPE_FORM_VALUES,
  toRecipeBody,
  toRecipeFormValues,
} from "./schemas";
import {
  useCreateRecipeMutation,
  useUpdateRecipeMutation,
} from "./useRecipeMutations";
import { useProductNames, useRecipe } from "./useRecipes";

interface Props {
  /** `null` — создание нового рецепта */
  recipeId: string | null;
  onSaved: (recipeId: string) => void;
  onCancel: () => void;
}

/**
 * Загрузка данных для формы рецепта и отправка результата.
 *
 * Форма монтируется только с готовыми значениями: react-hook-form берёт
 * `defaultValues` при монтировании, и подставить их позже означало бы
 * сбрасывать уже начатый ввод.
 */
export function RecipeFormPanel({ recipeId, onSaved, onCancel }: Props) {
  const { t } = useTranslation("recipes");

  const recipe = useRecipe(recipeId);
  const productNames = useProductNames(
    recipe.data?.ingredients.map((ingredient) => ingredient.product_id) ?? [],
  );

  const create = useCreateRecipeMutation();
  const update = useUpdateRecipeMutation(recipeId);

  if (recipeId !== null) {
    if (recipe.isLoading || productNames.isLoading) {
      return (
        <p role="status" className="text-muted-foreground">
          {t("form.loading")}
        </p>
      );
    }

    if (recipe.isError || !recipe.data) {
      return (
        <FormError>
          {errorMessageOf(recipe.error) ?? t("common:errors.unexpected")}
        </FormError>
      );
    }
  }

  const editing = recipeId !== null && recipe.data ? recipe.data : null;

  return (
    <RecipeForm
      mode={editing === null ? "create" : "edit"}
      defaultValues={
        editing === null
          ? EMPTY_RECIPE_FORM_VALUES
          : toRecipeFormValues(
              editing,
              productNames.byId,
              t("detail.unknownProduct"),
            )
      }
      pending={create.isPending || update.isPending}
      error={create.error ?? update.error}
      onCancel={onCancel}
      onSubmit={(values) => {
        const body = toRecipeBody(values);

        if (editing === null) {
          create.mutate(body, { onSuccess: (created) => onSaved(created.id) });
        } else {
          update.mutate(body, { onSuccess: () => onSaved(editing.id) });
        }
      }}
    />
  );
}
