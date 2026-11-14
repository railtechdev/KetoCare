import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Checkbox,
  FormFooter,
  Section,
  StatusNote,
} from "@ketocare/ui";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field, SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import {
  FormErrorSummary,
  errorSummaryItems,
} from "../../components/FormErrorSummary";
import { errorMessageOf } from "../../lib/api";
import { formatUsd } from "./format";
import {
  useCheckAiKey,
  useReplaceAiKey,
  useSaveAiGroup,
  useSaveAiProject,
  type AiGroupView,
  type AiKeyCheck,
  type AiSettings,
} from "./useAiSettings";

/** Верхняя граница бюджета — та же, что у сервера (`BUDGET_MAX_USD`). */
const BUDGET_MAX = 10000;
const LIMIT_MAX = 1000;

/** Пустое поле — «по умолчанию»; иначе положительное число в границах. */
const budget = z
  .string()
  .trim()
  .refine((value) => {
    if (value === "") return true;
    const number = Number(value.replace(",", "."));
    return Number.isFinite(number) && number > 0 && number <= BUDGET_MAX;
  });

const limit = z
  .string()
  .trim()
  .refine((value) => {
    if (value === "") return true;
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= LIMIT_MAX;
  });

function toBudget(value: string): string | null {
  return value === "" ? null : value.replace(",", ".");
}

function fromBudget(value: string | null | undefined): string {
  return value ?? "";
}

// --- группа задач ------------------------------------------------------------

const groupSchema = z.object({
  enabled: z.boolean(),
  model: z.string(),
  modelFast: z.string(),
  dailyBudget: budget,
  monthlyBudget: budget,
  userLimit: limit,
});

type GroupValues = z.infer<typeof groupSchema>;

/**
 * Настройки одной группы задач. Пустое поле — значение из окружения сервера:
 * оно подписано рядом, чтобы «по умолчанию» не было загадкой.
 */
export function AiGroupForm({
  group,
  models,
  onDone,
}: {
  group: AiGroupView;
  models: AiSettings["models"];
  onDone: () => void;
}) {
  const { t } = useTranslation("admin");
  const ids = useId();
  const save = useSaveAiGroup();

  const {
    register,
    handleSubmit,
    formState: { errors, submitCount },
  } = useForm<GroupValues>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      enabled: group.enabled,
      model: group.model ?? "",
      modelFast: group.model_fast ?? "",
      dailyBudget: fromBudget(group.daily_budget_usd),
      monthlyBudget: fromBudget(group.monthly_budget_usd),
      userLimit:
        group.user_daily_limit === null ? "" : String(group.user_daily_limit),
    },
    mode: "onBlur",
    reValidateMode: "onBlur",
  });

  const modelOptions = (fallback: string | null | undefined) => (
    <>
      <option value="">
        {fallback
          ? t("ai.groupForm.modelDefault", { model: fallback })
          : t("ai.groupForm.modelMissing")}
      </option>
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {t("ai.groupForm.modelOption", {
            model: model.id,
            priceIn: formatUsd(model.usd_per_mtok_in),
            priceOut: formatUsd(model.usd_per_mtok_out),
          })}
        </option>
      ))}
    </>
  );

  const counted = group.per_person_kinds
    .map((kind) => t(`ai.kinds.${kind}`))
    .join(", ");

  return (
    <form
      noValidate
      className="flex flex-col gap-section"
      onSubmit={handleSubmit((values) =>
        save.mutate(
          {
            group: group.group,
            body: {
              enabled: values.enabled,
              model: values.model || null,
              model_fast: group.has_fast ? values.modelFast || null : null,
              daily_budget_usd: toBudget(values.dailyBudget),
              monthly_budget_usd: toBudget(values.monthlyBudget),
              user_daily_limit:
                values.userLimit === "" ? null : Number(values.userLimit),
            },
          },
          { onSuccess: onDone },
        ),
      )}
    >
      <FormErrorSummary
        title={t("errorSummary.title")}
        items={errorSummaryItems(submitCount, [
          [`${ids}-daily`, errors.dailyBudget && t("ai.errors.budget")],
          [`${ids}-monthly`, errors.monthlyBudget && t("ai.errors.budget")],
          [`${ids}-limit`, errors.userLimit && t("ai.errors.limit")],
        ])}
        focusKey={submitCount}
      />

      <Section title={t(`ai.groups.${group.group}.title`)}>
        {save.isError && (
          <FormError>
            {errorMessageOf(save.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <label
          htmlFor={`${ids}-enabled`}
          className="flex min-h-touch items-center gap-field text-sm font-medium"
        >
          <Checkbox id={`${ids}-enabled`} {...register("enabled")} />
          {t("ai.groupForm.enabled")}
        </label>

        <SelectField
          id={`${ids}-model`}
          label={t("ai.groupForm.model")}
          hint={t("ai.groupForm.modelHint")}
          {...register("model")}
        >
          {modelOptions(group.defaults.model)}
        </SelectField>

        {group.has_fast && (
          <SelectField
            id={`${ids}-model-fast`}
            label={t("ai.groupForm.modelFast")}
            hint={t("ai.groupForm.modelFastHint")}
            {...register("modelFast")}
          >
            {modelOptions(group.defaults.model_fast)}
          </SelectField>
        )}

        <Field
          id={`${ids}-daily`}
          width="narrow"
          inputMode="decimal"
          optional
          label={t("ai.groupForm.dailyBudget")}
          hint={t("ai.groupForm.budgetHint")}
          error={errors.dailyBudget && t("ai.errors.budget")}
          {...register("dailyBudget")}
        />
        <Field
          id={`${ids}-monthly`}
          width="narrow"
          inputMode="decimal"
          optional
          label={t("ai.groupForm.monthlyBudget")}
          hint={t("ai.groupForm.budgetHint")}
          error={errors.monthlyBudget && t("ai.errors.budget")}
          {...register("monthlyBudget")}
        />
        {group.per_person_kinds.length > 0 && (
          <Field
            id={`${ids}-limit`}
            width="narrow"
            inputMode="numeric"
            optional
            label={t("ai.groupForm.userLimit")}
            hint={t("ai.groupForm.userLimitHint", {
              count: group.defaults.user_daily_limit,
              kinds: counted,
            })}
            error={errors.userLimit && t("ai.errors.limit")}
            {...register("userLimit")}
          />
        )}

        <FormFooter
          submitLabel={t("common:actions.save")}
          pendingLabel={t("common:actions.saving")}
          pending={save.isPending}
          cancelLabel={t("common:actions.cancel")}
          onCancel={onDone}
        />
      </Section>
    </form>
  );
}

// --- бюджет проекта ----------------------------------------------------------

const projectSchema = z.object({ dailyBudget: budget, monthlyBudget: budget });
type ProjectValues = z.infer<typeof projectSchema>;

export function AiProjectForm({
  project,
  onDone,
}: {
  project: AiSettings["project"];
  onDone: () => void;
}) {
  const { t } = useTranslation("admin");
  const ids = useId();
  const save = useSaveAiProject();
  const {
    register,
    handleSubmit,
    formState: { errors, submitCount },
  } = useForm<ProjectValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      dailyBudget: fromBudget(project.daily_budget_usd),
      monthlyBudget: fromBudget(project.monthly_budget_usd),
    },
    mode: "onBlur",
    reValidateMode: "onBlur",
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-section"
      onSubmit={handleSubmit((values) =>
        save.mutate(
          {
            daily_budget_usd: toBudget(values.dailyBudget),
            monthly_budget_usd: toBudget(values.monthlyBudget),
          },
          { onSuccess: onDone },
        ),
      )}
    >
      <FormErrorSummary
        title={t("errorSummary.title")}
        items={errorSummaryItems(submitCount, [
          [`${ids}-daily`, errors.dailyBudget && t("ai.errors.budget")],
          [`${ids}-monthly`, errors.monthlyBudget && t("ai.errors.budget")],
        ])}
        focusKey={submitCount}
      />

      <Section title={t("ai.project.title")}>
        {save.isError && (
          <FormError>
            {errorMessageOf(save.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}
        <Field
          id={`${ids}-daily`}
          width="narrow"
          inputMode="decimal"
          optional
          label={t("ai.project.daily")}
          hint={t("ai.project.dailyHint", {
            value: formatUsd(project.default_daily_budget_usd),
          })}
          error={errors.dailyBudget && t("ai.errors.budget")}
          {...register("dailyBudget")}
        />
        <Field
          id={`${ids}-monthly`}
          width="narrow"
          inputMode="decimal"
          optional
          label={t("ai.project.monthly")}
          hint={t("ai.project.monthlyHint")}
          error={errors.monthlyBudget && t("ai.errors.budget")}
          {...register("monthlyBudget")}
        />
        <FormFooter
          submitLabel={t("common:actions.save")}
          pendingLabel={t("common:actions.saving")}
          pending={save.isPending}
          cancelLabel={t("common:actions.cancel")}
          onCancel={onDone}
        />
      </Section>
    </form>
  );
}

// --- ключ --------------------------------------------------------------------

const keySchema = z.object({
  apiKey: z.string().trim().min(20).max(400).regex(/^\S+$/),
});
type KeyValues = z.infer<typeof keySchema>;

/**
 * Новый ключ. Его можно проверить до сохранения: пробное обращение к списку
 * моделей поставщика бесплатно и отвечает, примет ли он ключ.
 */
export function AiKeyForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation("admin");
  const ids = useId();
  const replace = useReplaceAiKey();
  const check = useCheckAiKey();
  const {
    register,
    handleSubmit,
    getValues,
    trigger,
    formState: { errors, submitCount },
  } = useForm<KeyValues>({
    resolver: zodResolver(keySchema),
    defaultValues: { apiKey: "" },
    mode: "onBlur",
    reValidateMode: "onBlur",
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-section"
      onSubmit={handleSubmit((values) =>
        replace.mutate(values.apiKey.trim(), { onSuccess: onDone }),
      )}
    >
      <FormErrorSummary
        title={t("errorSummary.title")}
        items={errorSummaryItems(submitCount, [
          [`${ids}-key`, errors.apiKey && t("ai.errors.key")],
        ])}
        focusKey={submitCount}
      />

      <Section title={t("ai.key.replaceTitle")}>
        {replace.isError && (
          <FormError>
            {errorMessageOf(replace.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}
        <Field
          id={`${ids}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          label={t("ai.key.field")}
          hint={t("ai.key.fieldHint")}
          error={errors.apiKey && t("ai.errors.key")}
          {...register("apiKey")}
        />
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={check.isPending}
            onClick={async () => {
              if (await trigger("apiKey")) {
                check.mutate(getValues("apiKey").trim());
              }
            }}
          >
            {check.isPending ? t("ai.key.checking") : t("ai.key.check")}
          </Button>
        </div>
        <KeyCheckResult
          result={check.data}
          error={check.isError ? check.error : null}
        />
        <FormFooter
          submitLabel={t("common:actions.save")}
          pendingLabel={t("common:actions.saving")}
          pending={replace.isPending}
          cancelLabel={t("common:actions.cancel")}
          onCancel={onDone}
        />
      </Section>
    </form>
  );
}

export function KeyCheckResult({
  result,
  error,
}: {
  result: AiKeyCheck | undefined;
  error: unknown;
}) {
  const { t } = useTranslation("admin");
  if (error) {
    return (
      <FormError>
        {errorMessageOf(error) ?? t("common:errors.unexpected")}
      </FormError>
    );
  }
  if (!result) return null;
  if (result.ok) {
    return (
      <StatusNote>
        {result.models.length > 0
          ? t("ai.key.ok", { models: result.models.join(", ") })
          : t("ai.key.okNoModels")}
      </StatusNote>
    );
  }
  return (
    <FormError>
      {t(`ai.key.problem.${result.problem ?? "unexpected"}`)}
    </FormError>
  );
}
