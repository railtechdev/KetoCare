import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  FormFooter,
} from "@ketocare/ui";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import {
  FormErrorSummary,
  type FormErrorSummaryItem,
} from "./FormErrorSummary";
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
    formState: { errors, submitCount },
  } = useForm<EntryFormValues>({
    resolver: zodResolver(entryFormSchema),
    defaultValues,
    // Правило П8: сообщение появляется по уходу с поля, а не на каждой
    // набранной цифре — иначе форма спорит с пользователем во время ввода.
    mode: "onBlur",
    reValidateMode: "onBlur",
  });

  const nameId = `${ids}-name`;
  const sortId = `${ids}-sort`;

  const nameError = errors.nameRu && t("dictionaries.form.errors.name");
  const sortError = errors.sort && t("dictionaries.form.errors.sort");

  // Сводка появляется только после неудачной отправки: до неё ошибка живёт под
  // полем, с которого ушли (правило П8).
  const summary: FormErrorSummaryItem[] =
    submitCount === 0
      ? []
      : [
          { fieldId: nameId, message: nameError },
          { fieldId: sortId, message: sortError },
        ].filter(
          (item): item is FormErrorSummaryItem => item.message !== undefined,
        );

  return (
    <form
      noValidate
      className="flex flex-col gap-block"
      onSubmit={handleSubmit((values) =>
        onSubmit({ name_ru: values.nameRu.trim(), sort: values.sort }),
      )}
    >
      <FormErrorSummary
        title={t("errorSummary.title")}
        items={summary}
        focusKey={submitCount}
      />

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={3} className="text-card-title">
            {mode === "create"
              ? t("dictionaries.form.createTitle")
              : t("dictionaries.form.editTitle")}
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-block">
          {error !== null && error !== undefined && (
            <FormError>
              {errorMessageOf(error) ?? t("common:errors.unexpected")}
            </FormError>
          )}

          <Field
            id={nameId}
            label={t("dictionaries.form.name")}
            error={nameError}
            {...register("nameRu")}
          />

          <Field
            id={sortId}
            type="number"
            step="1"
            // Порядок вывода — целое, поэтому клавиатура числовая, а не
            // десятичная: запятая здесь не нужна.
            inputMode="numeric"
            label={t("dictionaries.form.sort")}
            error={sortError}
            {...register("sort", { valueAsNumber: true })}
          />
        </CardContent>

        <CardFooter>
          <FormFooter
            submitLabel={t("common:actions.save")}
            pendingLabel={t("common:actions.saving")}
            pending={pending}
            cancelLabel={t("common:actions.cancel")}
            onCancel={onCancel}
          />
        </CardFooter>
      </Card>
    </form>
  );
}
