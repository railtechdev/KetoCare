import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormFooter,
  toast,
} from "@ketocare/ui";
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
    copy.mutate(
      { from: values.from, to: date },
      // Подтверждение — тостом (правило П16 канона): «вечная» зелёная строка
      // висела под формой до перехода на другой день.
      { onSuccess: () => toast.success(t("copy.copied")) },
    );
  });

  return (
    <Card role="region" aria-label={t("copy.title")}>
      <CardHeader>
        <CardTitle>
          <h2 className="m-0 text-section-title">{t("copy.title")}</h2>
        </CardTitle>
        <CardDescription>{t("copy.hint")}</CardDescription>
      </CardHeader>

      <CardContent>
        <form
          onSubmit={(event) => void onSubmit(event)}
          noValidate
          className="flex flex-col gap-block"
        >
          <Field
            id={fieldId}
            type="date"
            label={t("copy.source")}
            className="w-auto"
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

          <FormFooter
            submitLabel={t("copy.submit")}
            pendingLabel={t("copy.copying")}
            pending={copy.isPending}
          />
        </form>
      </CardContent>
    </Card>
  );
}
