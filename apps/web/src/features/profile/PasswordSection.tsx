import { zodResolver } from "@hookform/resolvers/zod";
import { FormFooter, Section, toast } from "@ketocare/ui";
import { useMutation } from "@tanstack/react-query";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import {
  FormErrorSummary,
  type FormErrorSummaryItem,
} from "../../components/FormErrorSummary";
import { api, errorMessageOf, setAccessToken } from "../../lib/api";

/**
 * Минимальная длина пароля.
 *
 * Значение совпадает с серверным (`PasswordChange` в `apps/api/src/api/schemas.py`):
 * клиентская проверка здесь — удобство, а не защита, и расходиться с сервером
 * ей нельзя, иначе форма пропустит то, что сервер отвергнет.
 */
const MIN_LENGTH = 12;

const schema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(MIN_LENGTH),
    repeatPassword: z.string().min(1),
  })
  .refine((values) => values.newPassword === values.repeatPassword, {
    path: ["repeatPassword"],
  });

type Values = z.infer<typeof schema>;

/**
 * Смена своего пароля (раздел 11 ТЗ).
 *
 * Ручка `POST /users/me/password` существовала с этапа 1, но формы не было ни у
 * одной роли: сменить пароль было нельзя никому, а забытый пароль означал
 * потерю доступа насовсем — восстановления в продукте тоже нет.
 *
 * Смена обрывает все прежние сессии, поэтому сервер сразу возвращает новую
 * пару токенов: иначе тот, кто сменил пароль, вылетал бы из приложения
 * немедленно после успешного действия.
 */
export function PasswordSection() {
  const { t } = useTranslation("profile");
  const ids = useId();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, submitCount },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", repeatPassword: "" },
  });

  const change = useMutation({
    mutationFn: async (values: Values) => {
      const { data, error } = await api.POST("/api/v1/users/me/password", {
        body: {
          current_password: values.currentPassword,
          new_password: values.newPassword,
        },
      });
      if (error || !data) throw error ?? new Error("empty response");
      return data;
    },
    onSuccess: (tokens) => {
      // Прежние токены отозваны сменой пароля — работаем по новому.
      setAccessToken(tokens.access_token);
      toast.success(t("password.saved"));
      reset();
    },
  });

  const summary: FormErrorSummaryItem[] =
    submitCount === 0
      ? []
      : (
          [
            ["currentPassword", "current"],
            ["newPassword", "new"],
            ["repeatPassword", "repeat"],
          ] as const
        )
          .filter(([name]) => errors[name] !== undefined)
          .map(([, anchor]) => ({
            fieldId: `${ids}-${anchor}`,
            message: t(`password.errors.${anchor}`, { min: MIN_LENGTH }),
          }));

  return (
    <Section title={t("password.title")} description={t("password.intro")}>
      <form
        noValidate
        className="flex flex-col gap-block"
        onSubmit={handleSubmit((values) => change.mutate(values))}
      >
        <FormErrorSummary
          title={t("password.errorSummary")}
          items={summary}
          focusKey={submitCount}
        />

        <Field
          id={`${ids}-current`}
          type="password"
          // Ширина — как у соседнего блока «Личные данные»: два набора полей
          // разной ширины подряд читаются как две разные формы.
          width="wide"
          // Менеджеры паролей узнают поля по autoComplete и подставляют текущий
          // пароль сами; вставка ничем не ограничена (правило П21, WCAG 3.3.8).
          autoComplete="current-password"
          label={t("password.fields.current")}
          error={errors.currentPassword && t("password.errors.current")}
          {...register("currentPassword")}
        />

        <Field
          id={`${ids}-new`}
          type="password"
          width="wide"
          autoComplete="new-password"
          hint={t("password.hint", { min: MIN_LENGTH })}
          label={t("password.fields.new")}
          error={
            errors.newPassword && t("password.errors.new", { min: MIN_LENGTH })
          }
          {...register("newPassword")}
        />

        <Field
          id={`${ids}-repeat`}
          type="password"
          width="wide"
          autoComplete="new-password"
          label={t("password.fields.repeat")}
          error={errors.repeatPassword && t("password.errors.repeat")}
          {...register("repeatPassword")}
        />

        {change.isError && (
          <FormError>
            {errorMessageOf(change.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <FormFooter
          submitLabel={t("password.submit")}
          pendingLabel={t("password.submitting")}
          pending={change.isPending}
        />
      </form>
    </Section>
  );
}
