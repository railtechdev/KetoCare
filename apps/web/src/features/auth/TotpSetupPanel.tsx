import { zodResolver } from "@hookform/resolvers/zod";
import {
  AsyncSection,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormFooter,
  Skeleton,
} from "@ketocare/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { QrCode } from "../../components/QrCode";
import { SetPasswordPanel } from "./SetPasswordPanel";
import { BackupCodesPanel } from "./BackupCodesPanel";
import { FormError } from "../../components/FormError";
import { api, errorMessageOf } from "../../lib/api";
import { totpVerifySchema, type TotpVerifyValues } from "./schemas";
import { useSession } from "./useSession";
import { useTotpVerifyMutation } from "./useAuthMutations";

interface Props {
  /** Краткоживущий токен из ответа login со статусом totp_setup_required. */
  setupToken: string;
}

/**
 * Первичная настройка 2FA (раздел 5.2-5.3 ТЗ).
 *
 * Секрет становится действующим только после подтверждения кодом: до вызова
 * /auth/totp/verify старый второй фактор (если был) продолжает работать.
 */
export function TotpSetupPanel({ setupToken }: Props) {
  const { t } = useTranslation("auth");
  const { signIn } = useSession();
  const verify = useTotpVerifyMutation(setupToken);

  // useQuery, а не useEffect: гонки и повторные вызовы ведёт Query.
  // Сама ручка идемпотентна (повторный вызов возвращает тот же секрет-кандидат),
  // поэтому перезагрузка страницы после сканирования QR ничего не ломает.
  const setup = useQuery({
    queryKey: ["totp-setup", setupToken],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { data, error } = await api.POST("/api/v1/auth/totp/setup", {
        body: {},
        headers: { Authorization: `Bearer ${setupToken}` },
      });
      if (error || !data) throw error ?? new Error("Empty setup response");

      // QR рисует общий компонент кита (`components/QrCode`): картинка нужна
      // здесь и при выдаче доступа семье, а размер, поле вокруг и подпись для
      // скринридера видны только глазами — разъехались бы молча.
      return { secret: data.secret, provisioningUri: data.provisioning_uri };
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TotpVerifyValues>({ resolver: zodResolver(totpVerifySchema) });

  /**
   * Резервные коды, выданные вместе с включением второго фактора.
   *
   * Пока они на экране, вход не завершается: `signIn` переводит в кабинет
   * немедленно, и коды исчезли бы вместе с этим экраном — а показать их второй
   * раз невозможно, в базе только sha256.
   */
  const [issuedCodes, setIssuedCodes] = useState<string[] | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  /**
   * Пароль выдал администратор: вместо пары токенов сервер прислал токен
   * задания пароля. Сессии здесь нет намеренно — иначе настройка второго
   * фактора была бы обходом временного пароля (#232).
   */
  const [resetToken, setResetToken] = useState<string | null>(null);
  /** Коды переписаны: с этого момента экран можно менять. */
  const [codesSaved, setCodesSaved] = useState(false);

  const onSubmit = handleSubmit(async (values) => {
    const data = await verify.mutateAsync(values.code).catch(() => null);
    if (!data) return;
    setAccessToken(data.tokens?.access_token ?? null);
    setResetToken(data.password_reset_token ?? null);
    setIssuedCodes(data.backup_codes);
  });

  // Сначала коды, потом пароль: коды показываются один раз в жизни, и экран
  // задания пароля стёр бы их безвозвратно.
  if (codesSaved && resetToken !== null) {
    return <SetPasswordPanel resetToken={resetToken} />;
  }

  if (issuedCodes !== null) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-screen">
        <Card className="w-full max-w-form">
          <CardHeader>
            <CardTitle className="text-page-title">
              <h1 className="m-0 font-semibold">{t("backupCodes.title")}</h1>
            </CardTitle>
            <CardDescription>{t("backupCodes.setupIntro")}</CardDescription>
          </CardHeader>
          <CardContent>
            <BackupCodesPanel
              codes={issuedCodes}
              doneLabel={t("backupCodes.saved")}
              onDone={() => {
                if (resetToken !== null) {
                  // Временный пароль знает администратор: кабинет откроется
                  // после того, как владелец задаст свой.
                  setCodesSaved(true);
                  return;
                }
                // Переход в кабинет делает guard маршрута: App перевычисляет
                // его, как только в контексте появляется сессия.
                if (accessToken !== null) signIn(accessToken);
              }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-screen">
      <Card className="w-full max-w-form">
        <CardHeader>
          <CardTitle className="text-page-title">
            <h1 className="m-0 font-semibold">{t("totpSetup.title")}</h1>
          </CardTitle>
          <CardDescription>{t("totpSetup.intro")}</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-block">
          {/* Ключ ещё едет — место под QR держится скелетоном, иначе форма
              подпрыгивает в момент ответа. Ошибка запроса ключа — не ошибка
              формы: её можно повторить, и состояния ведёт AsyncSection. */}
          <AsyncSection
            loading={setup.isPending}
            skeleton={
              <div
                className="flex flex-col items-center gap-field"
                role="status"
                aria-busy="true"
              >
                <Skeleton className="size-44 rounded-md" />
                <Skeleton className="h-10 w-full" />
              </div>
            }
            error={
              setup.isError
                ? {
                    title: t("totpSetup.setupError.title"),
                    description:
                      errorMessageOf(setup.error) ??
                      t("totpSetup.setupError.body"),
                  }
                : null
            }
            retryLabel={t("common:actions.retry")}
            onRetry={() => void setup.refetch()}
            isEmpty={setup.data === undefined}
            empty={null}
          >
            <>
              {setup.data?.provisioningUri && (
                <QrCode
                  value={setup.data.provisioningUri}
                  alt={t("totpSetup.qrAlt")}
                />
              )}

              {setup.data?.secret && (
                <div className="flex flex-col gap-field">
                  {/* Не Label: ключ показывается, а не вводится, и связывать
                      подпись с полем ввода здесь не с чем. */}
                  <span className="text-sm font-medium">
                    {t("totpSetup.secretLabel")}
                  </span>
                  <code className="block rounded-lg border border-border bg-background px-3 py-2.5 font-mono break-all">
                    {setup.data.secret}
                  </code>
                </div>
              )}
            </>
          </AsyncSection>

          <form
            onSubmit={onSubmit}
            noValidate
            className="flex flex-col gap-block"
          >
            <Field
              id="totp-setup-code"
              inputMode="numeric"
              // Код вставляется из менеджера паролей и из уведомления —
              // ограничений на вставку здесь нет (правило П21 канона).
              autoComplete="one-time-code"
              label={t("totpSetup.codeLabel")}
              error={errors.code && t("totpSetup.codeFormat")}
              {...register("code")}
            />

            {verify.isError && (
              <FormError>
                {errorMessageOf(verify.error) ?? t("totpSetup.invalidCode")}
              </FormError>
            )}

            <FormFooter
              submitLabel={t("totpSetup.confirm")}
              pendingLabel={t("totpSetup.confirming")}
              pending={verify.isPending}
              disabled={!setup.data}
            />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
