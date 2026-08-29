import { ErrorState, Skeleton, toast } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
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
        <PageLayout title={t("form.editTitle")} width="form" onBack={onCancel}>
          <p role="status" className="sr-only">
            {t("form.loading")}
          </p>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </PageLayout>
      );
    }

    // Ошибка закрывает форму только тогда, когда открывать нечего. Рецепт уже
    // загружен — неудачное фоновое обновление оставляет форму на месте: иначе
    // оно стёрло бы начатую правку вместе с набранным текстом.
    if (!recipe.data) {
      return (
        <PageLayout title={t("form.editTitle")} width="form" onBack={onCancel}>
          <ErrorState
            title={t("detail.errorTitle")}
            description={
              errorMessageOf(recipe.error) ?? t("common:errors.unexpected")
            }
            retryLabel={t("common:actions.retry")}
            onRetry={() => void recipe.refetch()}
          />
        </PageLayout>
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
          create.mutate(body, {
            onSuccess: (created) => {
              toast.success(t("actions.createSuccess"));
              onSaved(created.id);
            },
          });
        } else {
          update.mutate(body, {
            onSuccess: () => {
              toast.success(t("actions.saveSuccess"));
              onSaved(editing.id);
            },
          });
        }
      }}
    />
  );
}
