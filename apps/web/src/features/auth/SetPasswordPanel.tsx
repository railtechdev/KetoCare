import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormFooter,
} from "@ketocare/ui";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { api, errorMessageOf } from "../../lib/api";
import { useSession } from "./useSession";

/** Совпадает с серверной проверкой (`PasswordSet` в `apps/api/src/api/schemas.py`). */
const MIN_LENGTH = 12;

const schema = z
  .object({
    newPassword: z.string().min(MIN_LENGTH),
    repeatPassword: z.string().min(1),
  })
  .refine((values) => values.newPassword === values.repeatPassword, {
    path: ["repeatPassword"],
  });

type Values = z.infer<typeof schema>;

/**
 * Задать свой пароль после сброса администратором.
 *
 * Временный пароль администратор передаёт голосом или в переписке, то есть его
 * знают двое. Поэтому вход по нему не даёт рабочей сессии: он приводит сюда, и
 * дальше кабинет открывается только с новым паролем.
 *
 * Текущий пароль здесь не спрашивается — владелец его не знает.
 */
export function SetPasswordPanel({ resetToken }: { resetToken: string }) {
  const { t } = useTranslation("auth");
  const { signIn } = useSession();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const setPassword = useMutation({
    mutationFn: async (values: Values) => {
      const { data, error } = await api.POST("/api/v1/auth/password/set", {
        // Токен сброса, а не токен сессии: сессии у этого человека ещё нет.
        headers: { Authorization: `Bearer ${resetToken}` },
        body: { new_password: values.newPassword },
      });
      if (error || !data) throw error ?? new Error("Empty response");
      return data;
    },
    onSuccess: (tokens) => signIn(tokens.access_token),
  });

  return (
    <div className="flex min-h-dvh items-center justify-center p-screen">
      <Card className="w-full max-w-form">
        <CardHeader>
          <CardTitle className="text-page-title">
            <h1 className="m-0 font-semibold">{t("setPassword.title")}</h1>
          </CardTitle>
          <CardDescription>{t("setPassword.intro")}</CardDescription>
        </CardHeader>

        <CardContent>
          <form
            noValidate
            className="flex flex-col gap-block"
            onSubmit={handleSubmit((values) => setPassword.mutate(values))}
          >
            <Field
              id="new-password"
              type="password"
              autoComplete="new-password"
              width="wide"
              label={t("setPassword.newPassword")}
              hint={t("setPassword.hint", { min: MIN_LENGTH })}
              error={
                errors.newPassword &&
                t("setPassword.tooShort", { min: MIN_LENGTH })
              }
              {...register("newPassword")}
            />

            <Field
              id="repeat-password"
              type="password"
              autoComplete="new-password"
              width="wide"
              label={t("setPassword.repeat")}
              error={errors.repeatPassword && t("setPassword.mismatch")}
              {...register("repeatPassword")}
            />

            {setPassword.isError && (
              <FormError>
                {errorMessageOf(setPassword.error) ??
                  t("common:errors.unexpected")}
              </FormError>
            )}

            <FormFooter
              submitLabel={t("setPassword.submit")}
              pendingLabel={t("setPassword.submitting")}
              pending={setPassword.isPending}
            />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
