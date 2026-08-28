import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { Field } from "../../components/Field";
import { SubmitButton } from "../../components/SubmitButton";
import { errorMessageOf } from "../../lib/api";
import { TotpSetupPanel } from "./TotpSetupPanel";
import { loginSchema, type LoginValues } from "./schemas";
import { useSession } from "./useSession";
import { useLoginMutation } from "./useAuthMutations";

export function LoginPage() {
  const { t } = useTranslation("auth");
  const { signIn } = useSession();
  const login = useLoginMutation();

  /** Токен первичной настройки 2FA, если сервер её потребовал. */
  const [setupToken, setSetupToken] = useState<string | null>(null);
  /** Показывать поле кода: 2FA настроена и обязательна при входе. */
  const [totpRequired, setTotpRequired] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  if (setupToken !== null) {
    return <TotpSetupPanel setupToken={setupToken} />;
  }

  const onSubmit = handleSubmit(async (values) => {
    try {
      const data = await login.mutateAsync(values);

      if (data.status === "totp_setup_required" && data.totp_setup_token) {
        // Приглашённому врачу/админу нужно завершить настройку второго фактора,
        // иначе войти нельзя в принципе (раздел 5.2 ТЗ).
        setSetupToken(data.totp_setup_token);
        return;
      }
      if (data.tokens?.access_token) {
        // Переход в кабинет делает guard маршрута: App перевычисляет его,
        // как только в контексте появляется сессия.
        signIn(data.tokens.access_token);
      }
    } catch {
      // 2FA настроена и обязательна — показываем поле кода, не теряя ввод.
      if (!totpRequired && !values.totpCode) setTotpRequired(true);
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        noValidate
        className="w-full max-w-md rounded-xl bg-card p-8 shadow-kc"
      >
        <h1 className="mb-6 text-2xl font-semibold">{t("login.title")}</h1>

        <Field
          id="email"
          type="email"
          autoComplete="username"
          label={t("login.email")}
          error={errors.email && t("login.emailInvalid")}
          {...register("email")}
        />

        <Field
          id="password"
          type="password"
          autoComplete="current-password"
          label={t("login.password")}
          error={errors.password && t("login.passwordRequired")}
          {...register("password")}
        />

        {totpRequired && (
          <Field
            id="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            label={t("login.totpCode")}
            {...register("totpCode")}
          />
        )}

        {login.isError && (
          // Сообщение приходит от сервера уже на русском (раздел 5.1 ТЗ);
          // свой текст — только если тело ответа не соответствует контракту.
          <FormError>
            {errorMessageOf(login.error) ?? t("login.invalidCredentials")}
          </FormError>
        )}

        <SubmitButton pending={login.isPending}>
          {login.isPending ? t("login.submitting") : t("login.submit")}
        </SubmitButton>
      </form>
    </div>
  );
}
