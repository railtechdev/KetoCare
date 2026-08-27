import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { api, errorMessageOf } from "../../lib/api";
import { useSession } from "./session";
import { TotpSetupForm } from "./TotpSetupForm";

type Stage =
  | { kind: "credentials" }
  | { kind: "totp_required" }
  | { kind: "totp_setup"; setupToken: string };

export function LoginForm() {
  const { t } = useTranslation("auth");
  const { signIn } = useSession();

  const [stage, setStage] = useState<Stage>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (stage.kind === "totp_setup") {
    return <TotpSetupForm setupToken={stage.setupToken} />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const { data, error: apiError } = await api.POST("/api/v1/auth/login", {
      body: {
        email,
        password,
        totp_code: totpCode.trim() === "" ? null : totpCode.trim(),
      },
    });

    setSubmitting(false);

    if (apiError || !data) {
      // Сообщение приходит от сервера уже на русском (раздел 5.1 ТЗ) — свой текст
      // подставляется только если тело ответа не соответствует контракту.
      setError(errorMessageOf(apiError) ?? t("login.invalidCredentials"));

      // 2FA обязательна и уже настроена: показываем поле кода, не теряя ввод.
      if (stage.kind === "credentials" && totpCode === "") {
        setStage({ kind: "totp_required" });
      }
      return;
    }

    if (data.status === "totp_setup_required" && data.totp_setup_token) {
      // Приглашённому врачу/админу нужно завершить настройку второго фактора,
      // иначе войти нельзя в принципе (раздел 5.2 ТЗ).
      setStage({ kind: "totp_setup", setupToken: data.totp_setup_token });
      return;
    }

    if (data.tokens?.access_token) {
      signIn(data.tokens.access_token);
    }
  }

  return (
    <div className="kc-auth">
      <form className="kc-auth__card" onSubmit={handleSubmit} noValidate>
        <h1>{t("login.title")}</h1>

        <div className="kc-field">
          <label className="kc-field__label" htmlFor="email">
            {t("login.email")}
          </label>
          <input
            className="kc-field__input"
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="kc-field">
          <label className="kc-field__label" htmlFor="password">
            {t("login.password")}
          </label>
          <input
            className="kc-field__input"
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {stage.kind === "totp_required" && (
          <div className="kc-field">
            <label className="kc-field__label" htmlFor="totp">
              {t("login.totpCode")}
            </label>
            <input
              className="kc-field__input"
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value)}
            />
          </div>
        )}

        {error !== null && (
          <p className="kc-error" role="alert">
            {error}
          </p>
        )}

        <button className="kc-button" type="submit" disabled={submitting}>
          {submitting ? t("login.submitting") : t("login.submit")}
        </button>
      </form>
    </div>
  );
}
