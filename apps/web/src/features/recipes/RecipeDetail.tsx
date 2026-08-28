import { MacroBar, RatioBadge, WarningBanner } from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { formatGrams } from "./format";
import { RecipePhoto } from "./RecipePhoto";
import {
  useDeleteRecipeMutation,
  usePublishRecipeMutation,
} from "./useRecipeMutations";
import { useProductNames, useRecipe } from "./useRecipes";

interface Props {
  recipeId: string;
  /** Правка доступна admin/dietitian; это UX, доступ проверяет сервер */
  canEdit: boolean;
  onBack: () => void;
  onEdit: (recipeId: string) => void;
}

const SECONDARY_BUTTON =
  "min-h-touch rounded-lg border border-line px-4 text-ink";

/** Карточка рецепта: состав, приготовление и показатели, посчитанные ядром. */
export function RecipeDetail({ recipeId, canEdit, onBack, onEdit }: Props) {
  const { t } = useTranslation("recipes");

  const recipe = useRecipe(recipeId);
  const productNames = useProductNames(
    recipe.data?.ingredients.map((ingredient) => ingredient.product_id) ?? [],
  );

  const publish = usePublishRecipeMutation();
  const remove = useDeleteRecipeMutation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const backButton = (
    <button type="button" onClick={onBack} className={SECONDARY_BUTTON}>
      {t("detail.back")}
    </button>
  );

  if (recipe.isLoading) {
    return (
      <section className="flex flex-col gap-4">
        {backButton}
        <p role="status" className="text-muted">
          {t("detail.loading")}
        </p>
      </section>
    );
  }

  if (recipe.isError || !recipe.data) {
    return (
      <section className="flex flex-col gap-4">
        {backButton}
        <FormError>
          {errorMessageOf(recipe.error) ?? t("common:errors.unexpected")}
        </FormError>
      </section>
    );
  }

  const data = recipe.data;
  const computed = data.computed;

  return (
    <section className="flex flex-col gap-6">
      {backButton}

      <header className="flex flex-col gap-2">
        <h1 className="m-0 text-xl font-semibold">{data.title}</h1>
        <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>{t(`categories.${data.category}`)}</span>
          {canEdit && (
            <span className="rounded-full border border-line px-2 py-0.5">
              {t(`status.${data.status}`)}
            </span>
          )}
        </p>
      </header>

      <RecipePhoto
        src={data.photo_path}
        className="h-56 w-full max-w-xl rounded-kc"
      />

      <section
        aria-label={t("detail.nutrition")}
        className="flex flex-col gap-3"
      >
        <h2 className="m-0 text-lg font-semibold">{t("detail.nutrition")}</h2>

        {computed === null ? (
          <p className="m-0 text-muted">{t("detail.noComputed")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-4">
              {/* Без вердикта о допуске: соотношение рецепта — характеристика
                  блюда, а не соответствие назначению конкретного ребёнка. */}
              <RatioBadge ratio={computed.ratio} />
              <span className="tabular-nums">
                {t("detail.kcal", { value: computed.kcal.toFixed(0) })}
              </span>
              <span className="text-muted tabular-nums">
                {t("detail.fiber", { value: formatGrams(computed.fiber) })}
              </span>
            </div>

            <MacroBar
              fatG={computed.fat}
              proteinG={computed.protein}
              carbsG={computed.carbs}
            />
          </>
        )}

        <p className="m-0 flex flex-wrap gap-4 text-sm text-muted tabular-nums">
          <span>{t("detail.yield", { grams: formatGrams(data.yield_g) })}</span>
          <span>{t("detail.servings", { value: data.servings })}</span>
        </p>

        {/* Версия ядра видна рядом с показателями: расчёты разных версий могут
            отличаться, и понять это нужно до того, как по рецепту накормят. */}
        <p className="m-0 text-xs text-muted">
          {data.engine_version === null
            ? t("detail.engineVersionUnknown")
            : t("detail.engineVersion", { version: data.engine_version })}
        </p>
      </section>

      <section aria-label={t("detail.composition")}>
        <h2 className="mt-0 mb-2 text-lg font-semibold">
          {t("detail.composition")}
        </h2>

        {data.ingredients.length === 0 ? (
          <p className="m-0 text-muted">{t("detail.compositionEmpty")}</p>
        ) : productNames.isLoading ? (
          <p role="status" className="m-0 text-muted">
            {t("detail.loadingProducts")}
          </p>
        ) : (
          <ul className="m-0 flex max-w-xl list-none flex-col gap-2 p-0">
            {data.ingredients.map((ingredient) => (
              <li
                key={ingredient.product_id}
                className="flex items-baseline justify-between gap-4 border-b border-line pb-1"
              >
                <span>
                  {productNames.byId[ingredient.product_id] ??
                    t("detail.unknownProduct")}
                </span>
                <span className="text-muted tabular-nums">
                  {t("detail.grams", { value: formatGrams(ingredient.grams) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t("detail.instructions")}>
        <h2 className="mt-0 mb-2 text-lg font-semibold">
          {t("detail.instructions")}
        </h2>
        {/* Переносы строк заданы автором рецепта — они и есть шаги готовки. */}
        <p className="m-0 max-w-2xl whitespace-pre-line">{data.instructions}</p>
      </section>

      {canEdit && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onEdit(data.id)}
              className={SECONDARY_BUTTON}
            >
              {t("actions.edit")}
            </button>

            {data.status !== "published" && (
              <button
                type="button"
                disabled={publish.isPending}
                onClick={() => publish.mutate(data.id)}
                className="min-h-touch rounded-lg bg-accent px-4 font-semibold text-on-accent disabled:opacity-60"
              >
                {publish.isPending
                  ? t("actions.publishing")
                  : t("actions.publish")}
              </button>
            )}

            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => setConfirmingDelete(true)}
              className={SECONDARY_BUTTON}
            >
              {remove.isPending ? t("actions.deleting") : t("actions.delete")}
            </button>
          </div>

          {confirmingDelete && (
            <WarningBanner
              level="danger"
              title={t("actions.confirmDelete.title")}
            >
              <p className="mt-0 mb-3">{t("actions.confirmDelete.body")}</p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(data.id, { onSuccess: () => onBack() })
                  }
                  className="min-h-touch rounded-lg bg-danger px-4 font-semibold text-on-danger disabled:opacity-60"
                >
                  {t("actions.confirmDelete.confirm")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className={SECONDARY_BUTTON}
                >
                  {t("actions.cancel")}
                </button>
              </div>
            </WarningBanner>
          )}

          {publish.isError && (
            <FormError>
              {errorMessageOf(publish.error) ?? t("common:errors.unexpected")}
            </FormError>
          )}

          {remove.isError && (
            <FormError>
              {errorMessageOf(remove.error) ?? t("common:errors.unexpected")}
            </FormError>
          )}
        </section>
      )}
    </section>
  );
}
