import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { SubmitButton } from "../../components/SubmitButton";
import { errorMessageOf } from "../../lib/api";
import { isIsoDate, shiftIsoDate } from "./dates";
import { useCopyDayMutation } from "./useMenu";

const copySchema = z.object({ from: z.string().refine(isIsoDate) });

type CopyValues = z.infer<typeof copySchema>;

interface Props {
  patientId: string | null;
  /** День, на который копируем: его состав будет заменён целиком */
  date: string;
}

/**
 * Копирование дня (раздел 8.3 ТЗ, строка «Меню»).
 *
 * Состав берётся с сервера и сохраняется на выбранную дату тем же PUT, что и
 * обычная правка дня: отдельной ручки копирования раздел 5.3 не предусматривает,
 * а собирать день из кэша нельзя — копируют и тот день, что ни разу не открывали.
 */
export function CopyDayForm({ patientId, date }: Props) {
  const { t } = useTranslation("menu");
  const copy = useCopyDayMutation(patientId);
  const fieldId = useId();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CopyValues>({
    resolver: zodResolver(copySchema),
    defaultValues: { from: shiftIsoDate(date, -1) },
  });

  const onSubmit = handleSubmit((values) => {
    if (values.from === date) {
      setError("from", { type: "sameDate" });
      return;
    }
    copy.mutate({ from: values.from, to: date });
  });

  return (
    <section
      aria-label={t("copy.title")}
      className="rounded-xl bg-card p-4 shadow-kc-sm"
    >
      <h2 className="m-0 text-lg font-semibold">{t("copy.title")}</h2>
      <p className="mt-2 text-muted-foreground">{t("copy.hint")}</p>

      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <Field
          id={fieldId}
          type="date"
          label={t("copy.source")}
          error={
            errors.from &&
            t(
              errors.from.type === "sameDate"
                ? "copy.sameDate"
                : "copy.invalidDate",
            )
          }
          {...register("from")}
        />

        {copy.isError && (
          <FormError>
            {errorMessageOf(copy.error) ?? t("copy.failed")}
          </FormError>
        )}

        {copy.isSuccess && (
          <p role="status" className="mb-4 text-success">
            {t("copy.copied")}
          </p>
        )}

        <SubmitButton pending={copy.isPending} className="w-auto px-6">
          {copy.isPending ? t("copy.copying") : t("copy.submit")}
        </SubmitButton>
      </form>
    </section>
  );
}
