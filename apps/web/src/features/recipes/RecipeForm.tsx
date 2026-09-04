import { zodResolver } from "@hookform/resolvers/zod";
import { Button, EmptyState, FormFooter, Input, toast } from "@ketocare/ui";
import { CookingPot, Sparkles, X } from "lucide-react";
import { useId } from "react";
import {
  useFieldArray,
  useForm,
  useWatch,
  type DefaultValues,
} from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Field, SelectField, TextAreaField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { ProductPicker } from "../calculator/ProductPicker";
import { recipeFormSchema, type RecipeFormValues } from "./schemas";
import { useRecipeDraftMutation, type DraftCheck } from "./useRecipeDraft";
import { RECIPE_CATEGORIES } from "./types";

interface Props {
  mode: "create" | "edit";
  defaultValues: DefaultValues<RecipeFormValues>;
  pending: boolean;
  /** Ошибка мутации: сообщение приходит от сервера уже на русском */
  error: unknown;
  onSubmit: (values: RecipeFormValues) => void;
  onCancel: () => void;
}

/**
 * Форма рецепта для admin/dietitian (раздел 5.3 ТЗ).
 *
 * Ограничение «не больше трёх полей на экран» относится к формам родителя
 * (раздел 8.3 ТЗ), поэтому здесь поля сгруппированы по смыслу, а не разбиты на
 * шаги: рецепт заполняет специалист за компьютером, и разрыв состава по шагам
 * мешал бы сверять его целиком.
 */
export function RecipeForm({
  mode,
  defaultValues,
  pending,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useTranslation("recipes");
  const ids = useId();

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<RecipeFormValues>({
    resolver: zodResolver(recipeFormSchema),
    defaultValues,
  });

  const ingredients = useFieldArray({ control, name: "ingredients" });

  // Черновик собирается по тому, что уже введено в форме: состав закрыт, и
  // модель получает готовый список, а не подбирает его сама.
  const draft = useRecipeDraftMutation();
  const watched = useWatch({ control });
  // Готов не «есть строки состава», а «в каждой строке выбран продукт»:
  // пустая строка уехала бы на сервер с пустым идентификатором и вернулась
  // ошибкой вместо подсказки.
  const draftReady =
    (watched.title ?? "").trim().length > 1 &&
    (watched.ingredients ?? []).length > 0 &&
    (watched.ingredients ?? []).every(
      (item) => (item?.productId ?? "") !== "" && (item?.grams ?? 0) > 0,
    );

  function requestDraft() {
    draft.mutate(
      {
        title: (watched.title ?? "").trim(),
        category: watched.category ?? "breakfast",
        servings:
          watched.servings && watched.servings > 0 ? watched.servings : 1,
        ingredients: (watched.ingredients ?? []).map((item) => ({
          product_id: item?.productId ?? "",
          grams: item?.grams ?? 0,
        })),
      },
      {
        onSuccess: (result) => {
          if (result.checks.some((check) => check.hard)) {
            // Жёсткая находка — обещание лечебного действия, бытовая мера
            // вместо граммов, упоминание лекарства. Такой текст не
            // подставляется сам: поле сохраняется соседней кнопкой, и
            // подставленное молча слишком легко сохранить не читая. Вставить
            // его всё равно можно — отдельным осознанным нажатием.
            toast.warning(t("form.draft.blocked"));
            return;
          }
          // Текст кладётся в поле, а не показывается отдельно: редактор правит
          // его там же, где сохраняет, и черновик не остаётся вторым текстом,
          // о котором легко забыть.
          setValue("instructions", result.instructions, { shouldDirty: true });
          toast.success(t("form.draft.done"));
        },
        onError: (error) =>
          toast.error(errorMessageOf(error) ?? t("common:errors.unexpected")),
      },
    );
  }

  const categoryId = `${ids}-category`;
  const instructionsId = `${ids}-instructions`;
  const compositionErrorId = `${ids}-composition-error`;

  const compositionEmpty = ingredients.fields.length === 0;

  return (
    <PageLayout
      title={mode === "create" ? t("form.createTitle") : t("form.editTitle")}
      width="form"
      onBack={onCancel}
    >
      <form
        noValidate
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-screen"
      >
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-block text-card-title font-semibold">
            {t("form.basics")}
          </legend>

          <div className="flex flex-col gap-block">
            <Field
              id={`${ids}-title`}
              label={t("form.title")}
              placeholder={t("form.titlePlaceholder")}
              error={errors.title && t("form.errors.title")}
              {...register("title")}
            />

            <SelectField
              id={categoryId}
              width="medium"
              label={t("form.category")}
              error={errors.category && t("form.errors.category")}
              {...register("category")}
            >
              {RECIPE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(`categories.${category}`)}
                </option>
              ))}
            </SelectField>

            {/* Поля «путь к фото» больше нет: фото загружается файлом в карточке
                рецепта, когда он уже существует (ADR-0013, решение 8). Строкой
                сюда можно было записать любой внешний адрес, и он уходил прямо
                в `src` картинки кабинета. Значение остаётся в форме скрытым,
                чтобы правка рецепта не стирала уже загруженное фото. */}
          </div>
        </fieldset>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-block text-card-title font-semibold">
            {t("form.portion")}
          </legend>

          <div className="grid gap-block sm:grid-cols-2">
            <Field
              id={`${ids}-yield`}
              width="narrow"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.1}
              label={t("form.yieldG")}
              error={errors.yieldG && t("form.errors.yieldG")}
              {...register("yieldG", { valueAsNumber: true })}
            />
            <Field
              id={`${ids}-servings`}
              width="narrow"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              label={t("form.servings")}
              error={errors.servings && t("form.errors.servings")}
              {...register("servings", { valueAsNumber: true })}
            />
          </div>
        </fieldset>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-block text-card-title font-semibold">
            {t("form.composition")}
          </legend>

          {/* Enter в поле поиска не должен отправлять форму: подбирая продукт,
              редактор сохранил бы наполовину заполненный рецепт. Сам выбор из
              списка ProductPicker обрабатывает раньше, на своём input. */}
          <div
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
          >
            <ProductPicker
              excludeIds={ingredients.fields.map((field) => field.productId)}
              onPick={(product) =>
                ingredients.append({
                  productId: product.id,
                  name: product.name,
                  grams: 50,
                })
              }
            />
          </div>

          {compositionEmpty ? (
            <EmptyState
              icon={CookingPot}
              title={t("form.emptyCompositionTitle")}
              description={t("form.emptyComposition")}
              className="mt-block"
            />
          ) : (
            <ul className="mt-block mb-0 flex list-none flex-col gap-field p-0">
              {ingredients.fields.map((field, index) => {
                const gramsId = `${ids}-grams-${field.id}`;
                const gramsError = errors.ingredients?.[index]?.grams;

                return (
                  <li
                    key={field.id}
                    className="flex flex-wrap items-center gap-block"
                  >
                    <span className="min-w-0 flex-1 break-words">
                      {field.name}
                    </span>

                    <label className="sr-only" htmlFor={gramsId}>
                      {t("form.grams", { name: field.name })}
                    </label>
                    <Input
                      id={gramsId}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.1}
                      aria-invalid={gramsError ? true : undefined}
                      aria-describedby={
                        gramsError ? `${gramsId}-error` : undefined
                      }
                      className="min-h-touch w-24 text-right tabular-nums"
                      {...register(`ingredients.${index}.grams`, {
                        valueAsNumber: true,
                      })}
                    />
                    <span className="text-muted-foreground">
                      {t("form.gramsUnit")}
                    </span>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="min-h-touch min-w-touch"
                      aria-label={t("form.removeIngredient", {
                        name: field.name,
                      })}
                      onClick={() => ingredients.remove(index)}
                    >
                      <X aria-hidden="true" />
                    </Button>

                    {gramsError && (
                      <p
                        id={`${gramsId}-error`}
                        className="w-full text-sm text-destructive"
                      >
                        {t("form.errors.grams")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {compositionEmpty && errors.ingredients && (
            <p
              id={compositionErrorId}
              role="alert"
              className="mt-field mb-0 text-sm text-destructive"
            >
              {t("form.errors.ingredients")}
            </p>
          )}

          <p className="mt-field mb-0 text-sm text-muted-foreground">
            {t("form.computedHint")}
          </p>
        </fieldset>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-block text-card-title font-semibold">
            {t("form.cooking")}
          </legend>

          <TextAreaField
            id={instructionsId}
            label={t("form.instructions")}
            rows={8}
            placeholder={t("form.instructionsPlaceholder")}
            error={errors.instructions && t("form.errors.instructions")}
            {...register("instructions")}
          />

          <div className="mt-field flex flex-col items-start gap-field">
            <Button
              type="button"
              variant="outline"
              className="min-h-touch"
              disabled={!draftReady || draft.isPending}
              aria-busy={draft.isPending || undefined}
              onClick={requestDraft}
            >
              <Sparkles aria-hidden="true" />
              {draft.isPending
                ? t("form.draft.pending")
                : t("form.draft.action")}
            </Button>
            <p className="m-0 text-sm text-muted-foreground">
              {draftReady
                ? t("form.draft.hint")
                : t("form.draft.needComposition")}
            </p>
            {draft.data && draft.data.checks.length > 0 && (
              <>
                <DraftChecks checks={draft.data.checks} />
                {draft.data.checks.some((check) => check.hard) && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-touch"
                    onClick={() => {
                      setValue("instructions", draft.data!.instructions, {
                        shouldDirty: true,
                      });
                      toast.success(t("form.draft.done"));
                    }}
                  >
                    {t("form.draft.insertAnyway")}
                  </Button>
                )}
              </>
            )}
          </div>
        </fieldset>

        {error !== null && error !== undefined && (
          <FormError>
            {errorMessageOf(error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <FormFooter
          submitLabel={
            mode === "create" ? t("form.submitCreate") : t("form.submitEdit")
          }
          pendingLabel={t("form.submitting")}
          pending={pending}
          cancelLabel={t("actions.cancel")}
          onCancel={onCancel}
        />
      </form>
    </PageLayout>
  );
}

/**
 * Что нашёл постфильтр в черновике.
 *
 * Показывается рядом с текстом, а не вместо него: текст уже в поле, и редактор
 * решает сам. Класс приходит с сервера кодом — формулировка живёт в словаре
 * (правило 8 CLAUDE.md).
 */
function DraftChecks({ checks }: { checks: DraftCheck[] }) {
  const { t } = useTranslation("recipes");

  return (
    <div className="flex flex-col gap-field">
      <p className="m-0 text-sm font-medium">{t("form.draft.checks")}</p>
      <ul className="m-0 flex list-none flex-col gap-field p-0">
        {checks.map((check, index) => (
          <li key={`${check.kind}-${index}`} className="text-sm">
            <span className={check.hard ? "text-destructive" : "text-warning"}>
              {t(`form.draft.kind.${check.kind}`, {
                defaultValue: t("form.draft.kind.other"),
              })}
            </span>
            {check.fragment && (
              <span className="text-muted-foreground">
                {" "}
                — «{check.fragment}»
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
