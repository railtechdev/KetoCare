import { zodResolver } from "@hookform/resolvers/zod";
import { FormFooter, toast } from "@ketocare/ui";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { isIsoDate, shiftIsoDate } from "./dates";
import { useCopyDayMutation } from "./useMenu";

const copySchema = z.object({ from: z.string().refine(isIsoDate) });

type CopyValues = z.infer<typeof copySchema>;

interface Props {
  patientId: string | null;
  /** День, на который копируем: его состав будет заменён целиком */
  date: string;
  /** Закрыть панель: копирование удалось */
  onCopied: () => void;
}

/**
 * Копирование дня (раздел 8.3 ТЗ, строка «Меню»).
 *
 * Живёт в панели, открытой действием шапки: копируют изредка, а раскрытая
 * форма занимала 272 px внизу каждого посещения меню (правило П31).
 *
 * Состав берётся с сервера и сохраняется на выбранную дату тем же PUT, что и
 * обычная правка дня: отдельной ручки копирования раздел 5.3 не предусматривает,
 * а собирать день из кэша нельзя — копируют и тот день, что ни разу не открывали.
 */
export function CopyDayForm({ patientId, date, onCopied }: Props) {
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
    copy.mutate(
      { from: values.from, to: date },
      // Подтверждение — тостом (правило П16 канона): «вечная» зелёная строка
      // висела под формой до перехода на другой день.
      {
        onSuccess: () => {
          toast.success(t("copy.copied"));
          onCopied();
        },
      },
    );
  });

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="flex flex-col gap-block"
    >
      <Field
        id={fieldId}
        type="date"
        label={t("copy.source")}
        width="date"
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
        <FormError>{errorMessageOf(copy.error) ?? t("copy.failed")}</FormError>
      )}

      <FormFooter
        submitLabel={t("copy.submit")}
        pendingLabel={t("copy.copying")}
        pending={copy.isPending}
      />
    </form>
  );
}
