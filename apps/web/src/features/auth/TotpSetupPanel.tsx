import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { SubmitButton } from "../../components/SubmitButton";
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
    <div className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        noValidate
        className="w-full max-w-md rounded-xl bg-card p-8 shadow-kc"
      >
        <h1 className="mb-2 text-2xl font-semibold">{t("totpSetup.title")}</h1>
        <p className="mb-6 text-muted-foreground">{t("totpSetup.intro")}</p>

        {setup.data?.qrSvg && (
          <div
            className="mb-4 flex justify-center [&_svg]:size-44 [&_svg]:rounded-md [&_svg]:bg-white [&_svg]:p-2"
            role="img"
            aria-label={t("totpSetup.qrAlt")}
            // Разметка построена локально библиотекой qrcode из строки, полученной
            // от нашего API, — это не пользовательский ввод.
            dangerouslySetInnerHTML={{ __html: setup.data.qrSvg }}
          />
        )}

        {setup.data?.secret && (
          <>
            <span className="mb-1.5 block text-sm font-medium">
              {t("totpSetup.secretLabel")}
            </span>
            <code className="mb-4 block rounded-lg border border-border bg-background px-3 py-2.5 font-mono break-all">
              {setup.data.secret}
            </code>
          </>
        )}

        <Field
          id="totp-setup-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          label={t("totpSetup.codeLabel")}
          error={errors.code && t("totpSetup.codeFormat")}
          {...register("code")}
        />

        {(setup.isError || verify.isError) && (
          <FormError>
            {errorMessageOf(setup.error ?? verify.error) ??
              t("totpSetup.invalidCode")}
          </FormError>
        )}

        <SubmitButton pending={verify.isPending} disabled={!setup.data}>
          {verify.isPending
            ? t("totpSetup.confirming")
            : t("totpSetup.confirm")}
        </SubmitButton>
      </form>
    </div>
  );
}
