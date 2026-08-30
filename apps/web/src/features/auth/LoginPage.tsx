import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormFooter,
} from "@ketocare/ui";
import { Activity } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { Field } from "../../components/Field";
import { errorMessageOf } from "../../lib/api";
import { SetPasswordPanel } from "./SetPasswordPanel";
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
  /**
   * Токен задания пароля: администратор выдал временный.
   *
   * Рабочей сессии сервер при этом не даёт — временный пароль знают двое, и
   * кабинет открывается только после того, как владелец задаст свой.
   */
  const [resetToken, setResetToken] = useState<string | null>(null);
  /** Показывать поле кода: 2FA настроена и обязательна при входе. */
  const [totpRequired, setTotpRequired] = useState(false);
  /**
   * Вход резервным кодом.
   *
   * Телефон с приложением теряется, ломается и остаётся дома. До резервных
   * кодов это означало потерю учётной записи навсегда: отключить второй фактор
   * нельзя, сброса не было ни у кого. Переключатель показывается только когда
   * код уже спрошен — до этого он был бы вопросом без повода.
   */
  const [useBackupCode, setUseBackupCode] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  if (setupToken !== null) {
    return <TotpSetupPanel setupToken={setupToken} />;
  }

  if (resetToken !== null) {
    return <SetPasswordPanel resetToken={resetToken} />;
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
      if (
        data.status === "password_change_required" &&
        data.password_reset_token
      ) {
        setResetToken(data.password_reset_token);
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
    <div className="flex min-h-dvh items-center justify-center p-screen">
      <div className="flex w-full max-w-form flex-col gap-block">
        {/* Знак продукта и одна строка о том, что это: человек приходит сюда по
            ссылке из письма и должен понять, куда попал, до того как введёт
            почту. Тот же значок стоит в шапке кабинета — вход не должен
            выглядеть чужой страницей. */}
        <div className="flex items-center gap-field">
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"
          >
            <Activity className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-card-title font-semibold">
              {t("login.brand")}
            </p>
            <p className="m-0 text-sm text-muted-foreground">
              {t("login.tagline")}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-page-title">
              <h1 className="m-0 font-semibold">{t("login.title")}</h1>
            </CardTitle>
            <CardDescription>{t("login.intro")}</CardDescription>
          </CardHeader>

          <CardContent>
            <form
              onSubmit={onSubmit}
              noValidate
              className="flex flex-col gap-block"
            >
              <Field
                id="email"
                type="email"
                // Менеджеры паролей узнают поле по autoComplete; вставка ничем
                // не ограничивается (правило П21 канона).
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

              {totpRequired &&
                (useBackupCode ? (
                  <Field
                    id="backup-code"
                    width="wide"
                    autoComplete="one-time-code"
                    label={t("login.backupCode")}
                    hint={t("login.backupCodeHint")}
                    {...register("backupCode")}
                  />
                ) : (
                  <Field
                    id="totp"
                    width="narrow"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    label={t("login.totpCode")}
                    hint={t("login.totpHint")}
                    {...register("totpCode")}
                  />
                ))}

              {totpRequired && (
                <Button
                  type="button"
                  variant="link"
                  className="min-h-touch self-start px-0"
                  onClick={() => setUseBackupCode((current) => !current)}
                >
                  {useBackupCode
                    ? t("login.useTotpCode")
                    : t("login.useBackupCode")}
                </Button>
              )}

              {login.isError && (
                // Сообщение приходит от сервера уже на русском (раздел 5.1 ТЗ);
                // свой текст — только если тело ответа не соответствует контракту.
                <FormError>
                  {errorMessageOf(login.error) ?? t("login.invalidCredentials")}
                </FormError>
              )}

              <FormFooter
                submitLabel={t("login.submit")}
                pendingLabel={t("login.submitting")}
                pending={login.isPending}
              />
            </form>
          </CardContent>
        </Card>

        {/* Регистрации в продукте нет: доступ выдаёт клиника (ADR-0003).
            Человек без учётной записи иначе упирается в форму, которую ему
            нечем заполнить, и не понимает, что делать дальше. */}
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="m-0 text-sm font-semibold">
            {t("login.noAccountTitle")}
          </p>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            {t("login.noAccount")}
          </p>
        </div>
      </div>
    </div>
  );
}
