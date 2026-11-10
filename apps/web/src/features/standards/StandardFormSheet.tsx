import { zodResolver } from "@hookform/resolvers/zod";
import { FormFooter, FormSheet, toast } from "@ketocare/ui";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Field, SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import {
  FormErrorSummary,
  errorSummaryItems,
} from "../../components/FormErrorSummary";
import { errorMessageOf } from "../../lib/api";
import {
  newEditionValues,
  standardFormSchema,
  toStandardCreateBody,
  toStandardUpdateBody,
  toStandardValues,
  EMPTY_STANDARD_VALUES,
  type StandardFormValues,
} from "./standardSchema";
import {
  useCreateStandardMutation,
  useUpdateStandardMutation,
  type FoodStandard,
} from "./useFoodStandards";

export type StandardEditing =
  | { kind: "create" }
  | { kind: "edit"; standard: FoodStandard }
  | { kind: "edition"; standard: FoodStandard };

function initialValues(editing: StandardEditing): StandardFormValues {
  if (editing.kind === "create") return EMPTY_STANDARD_VALUES;
  return editing.kind === "edit"
    ? toStandardValues(editing.standard)
    : newEditionValues(editing.standard);
}

/**
 * Заведение стандарта, его описание и новая редакция — одна форма.
 *
 * Вид, тип диеты и запись углеводов доступны только при создании: от них
 * зависит, как прочитаны уже заведённые значения. У закрытого стандарта
 * описание не правится вовсе, поэтому формы правки у него нет (`StandardsPanel`).
 */
export function StandardFormSheet({
  editing,
  onClose,
}: {
  editing: StandardEditing;
  onClose: () => void;
}) {
  const { t } = useTranslation("products");
  const ids = useId();

  const create = useCreateStandardMutation();
  const update = useUpdateStandardMutation(
    editing.kind === "edit" ? editing.standard.id : "",
  );
  const mutation = editing.kind === "edit" ? update : create;

  const {
    register,
    handleSubmit,
    formState: { errors, submitCount },
  } = useForm<StandardFormValues>({
    resolver: zodResolver(standardFormSchema),
    defaultValues: initialValues(editing),
    mode: "onBlur",
    reValidateMode: "onBlur",
  });

  const nameId = `${ids}-name`;
  const nameError = errors.name ? t("standards.form.nameRequired") : undefined;

  const done = () => {
    toast.success(t("standards.saved"));
    onClose();
  };

  const submit = (values: StandardFormValues) => {
    if (editing.kind === "edit") {
      update.mutate(toStandardUpdateBody(values, editing.standard.is_active), {
        onSuccess: done,
      });
    } else {
      create.mutate(toStandardCreateBody(values), { onSuccess: done });
    }
  };

  const creating = editing.kind !== "edit";
  const title =
    editing.kind === "create"
      ? t("standards.form.createTitle")
      : t(
          editing.kind === "edit"
            ? "standards.form.editTitle"
            : "standards.form.editionTitle",
          { name: editing.standard.name },
        );

  return (
    <FormSheet
      closeLabel={t("common:actions.close")}
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={t(
        editing.kind === "edition"
          ? "standards.form.editionIntro"
          : "standards.form.intro",
      )}
    >
      <form
        noValidate
        className="flex flex-col gap-section"
        onSubmit={handleSubmit(submit)}
      >
        <FormErrorSummary
          title={t("standards.form.errorSummary")}
          items={errorSummaryItems(submitCount, [[nameId, nameError]])}
          focusKey={submitCount}
        />

        <Field
          id={nameId}
          width="wide"
          label={t("standards.form.name")}
          required
          error={nameError}
          {...register("name")}
        />
        <Field
          id={`${ids}-publisher`}
          width="wide"
          label={t("standards.form.publisher")}
          optional
          {...register("publisher")}
        />
        <Field
          id={`${ids}-document`}
          width="wide"
          label={t("standards.form.document")}
          optional
          {...register("document")}
        />
        <Field
          id={`${ids}-version`}
          label={t("standards.form.version")}
          optional
          {...register("version")}
        />
        <Field
          id={`${ids}-effective`}
          width="date"
          type="date"
          label={t("standards.form.effectiveOn")}
          optional
          {...register("effectiveOn")}
        />

        {creating && (
          <>
            <SelectField
              id={`${ids}-kind`}
              width="wide"
              label={t("standards.form.kind")}
              hint={t("standards.form.kindHint")}
              {...register("kind")}
            >
              <option value="clinic">{t("standards.kind.clinic")}</option>
              <option value="reference">{t("standards.kind.reference")}</option>
            </SelectField>
            <SelectField
              id={`${ids}-diet`}
              width="wide"
              label={t("standards.form.dietType")}
              hint={t("standards.form.dietTypeHint")}
              {...register("dietType")}
            >
              <option value="ketogenic">{t("standards.diet.ketogenic")}</option>
              <option value="general">{t("standards.diet.general")}</option>
            </SelectField>
            <SelectField
              id={`${ids}-carbs`}
              width="wide"
              label={t("standards.form.carbs")}
              hint={t("standards.form.carbsHint")}
              {...register("carbsConvention")}
            >
              <option value="total">{t("standards.carbs.total")}</option>
              <option value="unknown">{t("standards.carbs.unknown")}</option>
            </SelectField>
          </>
        )}

        {mutation.isError && (
          <FormError>
            {errorMessageOf(mutation.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <FormFooter
          submitLabel={t("common:actions.save")}
          pendingLabel={t("common:actions.saving")}
          pending={mutation.isPending}
          onCancel={onClose}
          cancelLabel={t("common:actions.cancel")}
        />
      </form>
    </FormSheet>
  );
}
