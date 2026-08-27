import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { api, errorMessageOf } from "../../lib/api";
import { useSession } from "./session";

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
export function TotpSetupForm({ setupToken }: Props) {
  const { t } = useTranslation("auth");
  const { signIn } = useSession();

  const [secret, setSecret] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const authHeader = { Authorization: `Bearer ${setupToken}` };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { data, error: apiError } = await api.POST(
        "/api/v1/auth/totp/setup",
        {
          body: {},
          headers: authHeader,
        },
      );
      if (cancelled) return;

      if (data?.secret) {
        setSecret(data.secret);

        // QR рисуется из provisioning_uri, который отдаёт сервер: ключ в 32 символа
        // вручную вводят с ошибками, а в моноширинном шрифте 0 и O почти неотличимы.
        if (data.provisioning_uri) {
          try {
            setQrSvg(
              await QRCode.toString(data.provisioning_uri, {
                type: "svg",
                margin: 1,
                errorCorrectionLevel: "M",
              }),
            );
          } catch {
            // Без QR настройка всё равно возможна по ключу ниже — не показываем ошибку.
          }
        }
      } else {
        setError(errorMessageOf(apiError));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupToken]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const { data, error: apiError } = await api.POST(
      "/api/v1/auth/totp/verify",
      {
        body: { code: code.trim() },
        headers: authHeader,
      },
    );

    setSubmitting(false);

    if (data?.access_token) {
      signIn(data.access_token);
      return;
    }
    setError(errorMessageOf(apiError) ?? t("totpSetup.invalidCode"));
  }

  return (
    <div className="kc-auth">
      <form className="kc-auth__card" onSubmit={handleSubmit} noValidate>
        <h1>{t("totpSetup.title")}</h1>
        <p className="kc-auth__intro">{t("totpSetup.intro")}</p>

        {qrSvg !== null && (
          <div
            className="kc-qr"
            role="img"
            aria-label={t("totpSetup.qrAlt")}
            // Разметка построена локально библиотекой qrcode из строки, полученной
            // от нашего API, — это не пользовательский ввод.
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        )}

        {secret !== null && (
          <>
            <span className="kc-field__label">
              {t("totpSetup.secretLabel")}
            </span>
            <code className="kc-secret">{secret}</code>
          </>
        )}

        <div className="kc-field">
          <label className="kc-field__label" htmlFor="totp-setup-code">
            {t("totpSetup.codeLabel")}
          </label>
          <input
            className="kc-field__input"
            id="totp-setup-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>

        {error !== null && (
          <p className="kc-error" role="alert">
            {error}
          </p>
        )}

        <button
          className="kc-button"
          type="submit"
          disabled={submitting || secret === null}
        >
          {submitting ? t("totpSetup.confirming") : t("totpSetup.confirm")}
        </button>
      </form>
    </div>
  );
}
