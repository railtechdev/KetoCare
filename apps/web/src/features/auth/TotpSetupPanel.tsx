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
import QRCode from "qrcode";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
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

      // QR рисуется из provisioning_uri: ключ в 32 символа вводят с ошибками,
      // а в моноширинном шрифте 0 и O почти неотличимы.
      const qrSvg = data.provisioning_uri
        ? await QRCode.toString(data.provisioning_uri, {
            type: "svg",
            margin: 1,
            errorCorrectionLevel: "M",
          }).catch(() => null)
        : null;

      return { secret: data.secret, qrSvg };
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TotpVerifyValues>({ resolver: zodResolver(totpVerifySchema) });

  const onSubmit = handleSubmit(async (values) => {
    const data = await verify.mutateAsync(values.code).catch(() => null);
    // Переход в кабинет делает guard маршрута: App перевычисляет его, как
    // только в контексте появляется сессия.
    if (data?.access_token) signIn(data.access_token);
  });

  return (
    <div className="flex min-h-screen items-center justify-center p-screen">
      <Card className="w-full max-w-form">
        <CardHeader>
          <CardTitle className="text-page-title">
            {t("totpSetup.title")}
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
              {setup.data?.qrSvg && (
                <div
                  className="flex justify-center [&_svg]:size-44 [&_svg]:rounded-md [&_svg]:bg-white [&_svg]:p-2"
                  role="img"
                  aria-label={t("totpSetup.qrAlt")}
                  // Разметка построена локально библиотекой qrcode из строки, полученной
                  // от нашего API, — это не пользовательский ввод.
                  dangerouslySetInnerHTML={{ __html: setup.data.qrSvg }}
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
