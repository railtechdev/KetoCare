import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { SubmitButton } from "../../components/SubmitButton";
import { errorMessageOf } from "../../lib/api";
import type { DictionaryEntryCreateBody } from "./types";

const entryFormSchema = z.object({
  nameRu: z.string().trim().min(1),
  /** Порядок вывода в списках: целое, одинаковые значения допустимы */
  sort: z.number().int(),
});

type EntryFormValues = z.infer<typeof entryFormSchema>;

interface Props {
  mode: "create" | "edit";
  defaultValues: EntryFormValues;
  pending: boolean;
  /** Ошибка мутации: сообщение приходит от сервера уже на русском */
  error: unknown;
  onSubmit: (body: DictionaryEntryCreateBody) => void;
  onCancel: () => void;
}

/**
 * Значение справочника: название и порядок вывода.
 *
 * Тело одинаково для создания и правки, поэтому форма отдаёт его целиком:
 * PATCH с обоими полями пишет в `audit_log` полный снимок значения, а не
 * обрывок, по которому не восстановить, что было до правки.
 */
export function DictionaryEntryForm({
  mode,
  defaultValues,
  pending,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useTranslation("admin");
  const ids = useId();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EntryFormValues>({
    resolver: zodResolver(entryFormSchema),
    defaultValues,
  });

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) =>
        onSubmit({ name_ru: values.nameRu.trim(), sort: values.sort }),
      )}
      className="rounded-kc border border-line p-4"
    >
      <h3 className="mt-0 mb-4 text-base font-semibold">
        {mode === "create"
          ? t("dictionaries.form.createTitle")
          : t("dictionaries.form.editTitle")}
      </h3>

      {error !== null && error !== undefined && (
        <FormError>
          {errorMessageOf(error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <Field
        id={`${ids}-name`}
        label={t("dictionaries.form.name")}
        error={errors.nameRu && t("dictionaries.form.errors.name")}
        {...register("nameRu")}
      />

      <Field
        id={`${ids}-sort`}
        type="number"
        step="1"
        inputMode="numeric"
        label={t("dictionaries.form.sort")}
        error={errors.sort && t("dictionaries.form.errors.sort")}
        {...register("sort", { valueAsNumber: true })}
      />

      <div className="flex gap-3">
        <SubmitButton pending={pending} className="max-w-48">
          {t("common:actions.save")}
        </SubmitButton>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-touch max-w-48 flex-1 rounded-lg border border-line px-4 text-ink"
        >
          {t("common:actions.cancel")}
        </button>
      </div>
    </form>
  );
}
