import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  MacroBar,
  RatioBadge,
  Section,
  Skeleton,
  toast,
  WarningBanner,
} from "@ketocare/ui";
import { Download, Pencil, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { formatGrams } from "./format";
import { FileField } from "../../components/Field";
import { RecipePhoto } from "./RecipePhoto";
import {
  useDeleteRecipeMutation,
  usePublishRecipeMutation,
  useUnpublishRecipeMutation,
  useUploadRecipePhotoMutation,
} from "./useRecipeMutations";
import { useProductNames, useRecipe } from "./useRecipes";

interface Props {
  recipeId: string;
  /** Правка доступна admin/dietitian; это UX, доступ проверяет сервер */
  canEdit: boolean;
  onBack: () => void;
  onEdit: (recipeId: string) => void;
}

/** Карточка рецепта: состав, приготовление и показатели, посчитанные ядром. */
export function RecipeDetail({ recipeId, canEdit, onBack, onEdit }: Props) {
  const { t } = useTranslation("recipes");

  const recipe = useRecipe(recipeId);
  const productNames = useProductNames(
    recipe.data?.ingredients.map((ingredient) => ingredient.product_id) ?? [],
  );

  const publish = usePublishRecipeMutation();
  const unpublish = useUnpublishRecipeMutation();
  const remove = useDeleteRecipeMutation();
  const uploadPhoto = useUploadRecipePhotoMutation();

  const data = recipe.data;

  // Ошибка занимает весь экран только тогда, когда показывать нечего. Если
  // рецепт уже загружен, неудачное обновление не прячет его: React Query
  // держит прежний ответ, и подменять состав красным блоком значит стирать с
  // экрана данные, по которым сейчас готовят (то же правило — в AsyncSection).
  if (data === undefined) {
    return (
      <PageLayout
        title={t("detail.titleFallback")}
        onBack={onBack}
        backLabel={t("detail.back")}
      >
        {recipe.isError ? (
          <ErrorState
            title={t("detail.errorTitle")}
            description={
              errorMessageOf(recipe.error) ?? t("common:errors.unexpected")
            }
            retryLabel={t("common:actions.retry")}
            onRetry={() => void recipe.refetch()}
          />
        ) : (
          <>
            <p role="status" className="sr-only">
              {t("detail.loading")}
            </p>
            <Skeleton className="h-56 w-full max-w-xl rounded-xl" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </>
        )}
      </PageLayout>
    );
  }

  const computed = data.computed;
  const perPortion = data.per_portion;

  return (
    <PageLayout
      title={data.title}
      onBack={onBack}
      backLabel={t("detail.back")}
      intro={
        <span className="flex flex-wrap items-center gap-field">
          <span>{t(`categories.${data.category}`)}</span>
          {canEdit && (
            <Badge variant="outline">{t(`status.${data.status}`)}</Badge>
          )}
        </span>
      }
      actions={
        canEdit && (
          <>
            <Button
              type="button"
              variant="outline"
              className="min-h-touch"
              onClick={() => onEdit(data.id)}
            >
              <Pencil aria-hidden="true" />
              {t("actions.edit")}
            </Button>

            {data.status !== "published" ? (
              <Button
                type="button"
                className="min-h-touch"
                disabled={publish.isPending}
                onClick={() =>
                  publish.mutate(data.id, {
                    onSuccess: () => toast.success(t("actions.publishSuccess")),
                  })
                }
              >
                <Upload aria-hidden="true" />
                {publish.isPending
                  ? t("actions.publishing")
                  : t("actions.publish")}
              </Button>
            ) : (
              /* Подтверждение называет рецепт: снятие с публикации убирает его
                 у всех семей разом, а уже составленные дни не трогает —
                 их состав заморожен снимком (ADR-0016). */
              <ConfirmDialog
                trigger={
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-touch"
                    disabled={unpublish.isPending}
                  >
                    <Download aria-hidden="true" />
                    {unpublish.isPending
                      ? t("actions.unpublishing")
                      : t("actions.unpublish")}
                  </Button>
                }
                title={t("actions.confirmUnpublish.title", {
                  title: data.title,
                })}
                description={t("actions.confirmUnpublish.body")}
                confirmLabel={t("actions.confirmUnpublish.confirm")}
                cancelLabel={t("actions.cancel")}
                onConfirm={() =>
                  unpublish.mutate(data.id, {
                    onSuccess: () =>
                      toast.success(t("actions.unpublishSuccess")),
                  })
                }
              />
            )}

            {/* Заголовок диалога называет рецепт: подтверждается исчезновение
                конкретного блюда, а не абстрактное «вы уверены?». */}
            <ConfirmDialog
              trigger={
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-touch"
                  disabled={remove.isPending}
                >
                  <Trash2 aria-hidden="true" />
                  {remove.isPending
                    ? t("actions.deleting")
                    : t("actions.delete")}
                </Button>
              }
              title={t("actions.confirmDelete.title", { title: data.title })}
              description={t("actions.confirmDelete.body")}
              confirmLabel={t("actions.confirmDelete.confirm")}
              cancelLabel={t("actions.cancel")}
              onConfirm={() =>
                remove.mutate(data.id, {
                  onSuccess: () => {
                    toast.success(t("actions.deleteSuccess"));
                    onBack();
                  },
                })
              }
            />
          </>
        )
      }
    >
      {/* Обновление рецепта не удалось, но сам рецепт на экране остаётся:
          сообщение идёт над ним и предлагает повторить. */}
      {recipe.isError && (
        <ErrorState
          title={t("detail.errorTitle")}
          description={
            errorMessageOf(recipe.error) ?? t("common:errors.unexpected")
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void recipe.refetch()}
        />
      )}

      {publish.isError && (
        <FormError>
          {errorMessageOf(publish.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {unpublish.isError && (
        <FormError>
          {errorMessageOf(unpublish.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {remove.isError && (
        <FormError>
          {errorMessageOf(remove.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <Section title={t("detail.photo")} density="compact">
        <RecipePhoto
          recipeId={data.id}
          photoPath={data.photo_path}
          className="h-56 w-full max-w-xl rounded-xl"
        />

        {canEdit && (
          <>
            <FileField
              id="recipe-photo"
              width="wide"
              accept="image/jpeg,image/png,image/webp"
              label={t("detail.photoUpload")}
              hint={t("detail.photoHint")}
              disabled={uploadPhoto.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                uploadPhoto.mutate(
                  { recipeId: data.id, file },
                  { onSuccess: () => toast.success(t("detail.photoSaved")) },
                );
                // Поле сбрасывается: иначе повторный выбор того же файла не
                // вызовет `change`, и починить неудачную загрузку было бы
                // нечем, кроме перезагрузки страницы.
                event.target.value = "";
              }}
            />

            {uploadPhoto.isPending && (
              <p role="status" className="m-0 text-sm text-muted-foreground">
                {t("detail.photoUploading")}
              </p>
            )}

            {uploadPhoto.isError && (
              <FormError>
                {errorMessageOf(uploadPhoto.error) ??
                  t("common:errors.unexpected")}
              </FormError>
            )}
          </>
        )}
      </Section>

      <Section title={t("detail.nutrition")}>
        {computed === null ? (
          <p className="m-0 text-muted-foreground">{t("detail.noComputed")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-block">
              {/* Без вердикта о допуске: соотношение рецепта — характеристика
                      блюда, а не соответствие назначению конкретного ребёнка. */}
              <RatioBadge ratio={computed.ratio} />
              <span className="tabular-nums">
                {t("detail.kcal", { value: computed.kcal.toFixed(0) })}
              </span>
              <span className="text-muted-foreground tabular-nums">
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

        {/* Показатели выше — на весь выход рецепта. Человеку у плиты нужно
            другое число: сколько в одной порции. Пока его не было рядом, семья
            делила в уме — а по этой же порции считается день ребёнка. */}
        {perPortion !== null && data.servings > 1 && (
          <p className="m-0 flex flex-wrap items-center gap-block tabular-nums">
            <span className="font-medium">{t("detail.perPortion")}</span>
            <span>
              {t("detail.kcal", { value: perPortion.kcal.toFixed(0) })}
            </span>
            <span className="text-muted-foreground">
              {t("detail.macros", {
                fat: formatGrams(perPortion.fat),
                protein: formatGrams(perPortion.protein),
                carbs: formatGrams(perPortion.carbs),
              })}
            </span>
          </p>
        )}

        <p className="m-0 flex flex-wrap gap-block text-sm text-muted-foreground tabular-nums">
          <span>{t("detail.yield", { grams: formatGrams(data.yield_g) })}</span>
          <span>{t("detail.servings", { value: data.servings })}</span>
        </p>

        {/* Версия ядра видна рядом с показателями: расчёты разных версий могут
                отличаться, и понять это нужно до того, как по рецепту накормят. */}
        <p className="m-0 text-xs text-muted-foreground">
          {data.engine_version === null
            ? t("detail.engineVersionUnknown")
            : t("detail.engineVersion", { version: data.engine_version })}
        </p>
      </Section>

      {/* Показатели рецепта посчитаны в том числе по выведенному продукту —
          знать об этом нужно до того, как по рецепту приготовят. */}
      {Object.keys(productNames.withdrawn).length > 0 && (
        <WarningBanner level="warning" title={t("detail.withdrawnTitle")}>
          {t("detail.withdrawnBody", {
            list: Object.values(productNames.withdrawn).join(", "),
          })}
        </WarningBanner>
      )}

      <Section title={t("detail.composition")}>
        {data.ingredients.length === 0 ? (
          <p className="m-0 text-muted-foreground">
            {t("detail.compositionEmpty")}
          </p>
        ) : productNames.isLoading ? (
          <div className="flex flex-col gap-field">
            <p role="status" className="sr-only">
              {t("detail.loadingProducts")}
            </p>
            {data.ingredients.map((ingredient) => (
              <Skeleton key={ingredient.product_id} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          <ul className="m-0 flex max-w-xl list-none flex-col gap-field p-0">
            {data.ingredients.map((ingredient) => (
              <li
                key={ingredient.product_id}
                className="flex items-baseline justify-between gap-block border-b border-border pb-1"
              >
                <span>
                  {productNames.byId[ingredient.product_id] ??
                    t("detail.unknownProduct")}
                  {productNames.withdrawn[ingredient.product_id] !==
                    undefined && (
                    <span className="ml-2 text-sm text-warning">
                      {t("detail.withdrawn")}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {t("detail.grams", {
                    value: formatGrams(ingredient.grams),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("detail.instructions")}>
        {/* Переносы строк заданы автором рецепта — они и есть шаги готовки. */}
        <p className="m-0 max-w-2xl whitespace-pre-line">{data.instructions}</p>
      </Section>
    </PageLayout>
  );
}
