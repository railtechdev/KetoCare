import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  EmptyState,
  FormFooter,
  Input,
  MacroBar,
  MacroFacts,
  RatioBadge,
  Section,
  cn,
  formatKcal,
  toast,
} from "@ketocare/ui";
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
import {
  FormErrorSummary,
  errorSummaryItems,
} from "../../components/FormErrorSummary";
import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { ProductPicker } from "../calculator/ProductPicker";
import { productLabel } from "./productLabel";
import { useRecipeComputed } from "./useRecipeComputed";
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
    formState: { errors, submitCount },
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

  /**
   * Показатели блюда по мере правки состава.
   *
   * Считает сервер (`/calc/verify`): своя арифметика в браузере — второй
   * источник клинических чисел рядом с ядром, и она разошлась бы с тем, что
   * сохранится. Разбор — в `useRecipeComputed`.
   */
  const computed = useRecipeComputed(
    (watched.ingredients ?? []).map((item) => ({
      productId: item?.productId ?? "",
      grams: item?.grams ?? 0,
    })),
  );

  const categoryId = `${ids}-category`;
  const instructionsId = `${ids}-instructions`;
  const compositionErrorId = `${ids}-composition-error`;

  const compositionEmpty = ingredients.fields.length === 0;
  const productSearchId = `${ids}-product-search`;

  const titleError = errors.title && t("form.errors.title");
  const categoryError = errors.category && t("form.errors.category");
  const yieldError = errors.yieldG && t("form.errors.yieldG");
  const servingsError = errors.servings && t("form.errors.servings");
  const gramsErrorText = t("form.errors.grams");
  const compositionError =
    compositionEmpty && errors.ingredients
      ? t("form.errors.ingredients")
      : undefined;
  const instructionsError =
    errors.instructions && t("form.errors.instructions");

  // Сводка повторяет порядок формы: основное, порция, состав (по строке на
  // продукт с неверной массой), приготовление. Пустой состав ведёт в поиск
  // продукта — исправляют его там, а не в строке сообщения.
  const summary = errorSummaryItems(submitCount, [
    [`${ids}-title`, titleError],
    [categoryId, categoryError],
    [`${ids}-yield`, yieldError],
    [`${ids}-servings`, servingsError],
    ...ingredients.fields.map(
      (field, index) =>
        [
          `${ids}-grams-${field.id}`,
          errors.ingredients?.[index]?.grams ? gramsErrorText : undefined,
        ] as const,
    ),
    [productSearchId, compositionError],
    [instructionsId, instructionsError],
  ]);

  return (
    <PageLayout
      title={mode === "create" ? t("form.createTitle") : t("form.editTitle")}
      width="form"
      onBack={onCancel}
    >
      <form
        noValidate
        onSubmit={handleSubmit(onSubmit)}
        className="@container flex flex-col gap-screen"
      >
        <FormErrorSummary items={summary} focusKey={submitCount} />

        <Section title={t("form.basics")}>
          <div className="flex flex-col gap-section">
            <Field
              id={`${ids}-title`}
              label={t("form.title")}
              placeholder={t("form.titlePlaceholder")}
              error={titleError}
              {...register("title")}
            />

            <SelectField
              id={categoryId}
              width="medium"
              label={t("form.category")}
              error={categoryError}
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
        </Section>

        <Section title={t("form.portion")}>
          <div className="grid gap-section @sm:grid-cols-2">
            <Field
              id={`${ids}-yield`}
              width="narrow"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.1}
              label={t("form.yieldG")}
              error={yieldError}
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
              error={servingsError}
              {...register("servings", { valueAsNumber: true })}
            />
          </div>
        </Section>

        <Section title={t("form.composition")}>
          {/* Enter в поле поиска не должен отправлять форму: подбирая продукт,
              редактор сохранил бы наполовину заполненный рецепт. Сам выбор из
              списка ProductPicker обрабатывает раньше, на своём input. */}
          <div
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
          >
            {/* Имя из подсказки в строку не сохраняется: до ответа справочника
                она скажет «загружаем название…», хотя человек только что видел
                имя в списке. Это размен на единый источник подписи — у всех
                строк он один, живое состояние карточки. Хранить имя в значениях
                формы нельзя: `defaultValues` читаются один раз при
                монтировании, и у строк, восстановленных из них, подпись
                застывала навсегда. Отдельного запроса ради имени не возникает:
                карточка нужна расчёту в любом случае. */}
            <ProductPicker
              inputId={productSearchId}
              excludeIds={ingredients.fields.map((field) => field.productId)}
              onPick={(product) =>
                ingredients.append({
                  productId: product.id,
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
              className="mt-section"
            />
          ) : (
            <ul className="mt-section mb-0 flex list-none flex-col gap-field p-0">
              {ingredients.fields.map((field, index) => {
                const gramsId = `${ids}-grams-${field.id}`;
                const gramsError = errors.ingredients?.[index]?.grams;
                const contribution = computed.contributions.get(
                  field.productId,
                );
                // Подпись — отображение, а не значение формы: `defaultValues`
                // читаются один раз при монтировании, и снимок имени застыл бы
                // на том, что было известно в тот миг («загружаем название…»
                // навсегда). Здесь она берётся из состояния на каждый рендер.
                const label = productLabel(
                  computed.stateOf(field.productId),
                  t,
                );

                return (
                  <li
                    key={field.id}
                    className="flex flex-wrap items-center gap-section"
                  >
                    <span className="min-w-0 flex-1 break-words">{label}</span>

                    <label className="sr-only" htmlFor={gramsId}>
                      {t("form.grams", { name: label })}
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
                        name: label,
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
                        {gramsErrorText}
                      </p>
                    )}

                    {/* Что даёт этот продукт. По итогу блюда видно только, что
                        оно мимо цели; что менять — видно по строке. Числа с
                        сервера, тем же компонентом кита, что в калькуляторе и
                        в Mini App: своё округление здесь означало бы, что одно
                        и то же блюдо выглядит по-разному. */}
                    {computed.uncounted.has(field.productId) ? (
                      <MacroFacts
                        className="w-full"
                        label={t("form.contribution", { name: label })}
                        uncounted={t("form.uncounted")}
                      />
                    ) : (
                      contribution && (
                        <MacroFacts
                          className="w-full"
                          label={t("form.contribution", { name: label })}
                          kcal={contribution.kcal}
                          fatG={contribution.fat_g}
                          proteinG={contribution.protein_g}
                          carbsG={contribution.carbs_g}
                          stale={computed.stale}
                        />
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {compositionError && (
            <p
              id={compositionErrorId}
              role="alert"
              className="mt-field mb-0 text-sm text-destructive"
            >
              {compositionError}
            </p>
          )}

          {/* Показатели блюда — здесь же, а не после сохранения.
              До этого форма не показывала ни одного числа, и подобрать
              граммовку в ней было нельзя: сохранить, посмотреть, вернуться,
              поправить. Целевых чисел рядом нет и быть не может — рецепт
              общий, он не привязан к ребёнку, и цель есть только там, где есть
              назначение (калькулятор, план дня). */}
          {computed.dish !== null && !compositionEmpty && (
            <div
              // «Занято» — только пока идёт расчёт. Незаполненная строка держит
              // его сколь угодно долго, и бесконечное «занято» для читающего с
              // экрана было бы неправдой; приглушение при этом остаётся: числа
              // относятся к прежнему составу.
              aria-busy={computed.pending}
              className={cn(
                "mt-section flex flex-col gap-field",
                computed.stale && "opacity-60 transition-opacity",
              )}
            >
              <div className="flex flex-wrap items-center gap-section">
                <RatioBadge ratio={computed.dish.ratio} />
                <span className="tabular-nums">
                  {t("form.computedKcal", {
                    value: formatKcal(computed.dish.kcal),
                  })}
                </span>
              </div>
              <MacroBar
                fatG={computed.dish.fat_g}
                proteinG={computed.dish.protein_g}
                carbsG={computed.dish.carbs_g}
                netCarbs={{
                  grams: computed.dish.net_carbs_g,
                  label: t("form.netCarbs"),
                  note: t("form.netCarbsNote"),
                }}
              />
              <p className="m-0 text-sm text-muted-foreground">
                {t("form.computedHint")}
              </p>
              {/* Версия ядра — рядом с любыми его числами, как в калькуляторе,
                  карточке рецепта и итогах дня: расчёт разных версий может
                  отличаться, и это должно быть видно. */}
              <p className="m-0 text-xs text-muted-foreground">
                {t("form.engineVersion", {
                  version: computed.dish.engine_version,
                })}
              </p>
            </div>
          )}

          {/* Удалённый продукт — не сбой, а состояние состава: повтор
              бессмысленен, поправить можно только состав. Молчать нельзя —
              без карточки расчёт не уйдёт никогда, и форма показывала бы
              пустоту вместо чисел, не назвав причины. */}
          {computed.hasMissingProduct && (
            <p
              role="status"
              className="mt-field mb-0 text-sm text-warning-strong"
            >
              {t("form.missingProduct")}
            </p>
          )}

          {computed.isError && !computed.hasMissingProduct && (
            <p
              role="status"
              className="mt-field mb-0 text-sm text-warning-strong"
            >
              {t("form.computedFailed")}
            </p>
          )}
        </Section>

        <Section title={t("form.cooking")}>
          <TextAreaField
            id={instructionsId}
            label={t("form.instructions")}
            rows={8}
            placeholder={t("form.instructionsPlaceholder")}
            error={instructionsError}
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
        </Section>

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
            <span
              className={
                check.hard ? "text-destructive" : "text-warning-strong"
              }
            >
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
