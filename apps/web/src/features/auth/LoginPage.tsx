import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormFooter,
  SegmentedControl,
  WarningBanner,
} from "@ketocare/ui";
import {
  Activity,
  ArrowLeft,
  KeyRound,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../lib/theme";

import { FormError } from "../../components/FormError";
import {
  FormErrorSummary,
  errorSummaryItems,
} from "../../components/FormErrorSummary";
import { Field } from "../../components/Field";
import { errorMessageOf } from "../../lib/api";
/**
 * Первичная настройка второго фактора грузится по требованию: внутри неё
 * генератор QR-кода — 71 кБ, которые до этого скачивал КАЖДЫЙ, кто открывал
 * страницу входа. Нужны они один раз в жизни и только специалисту, которого
 * пригласили в клинику; семья не видит этот экран никогда.
 */
const TotpSetupPanel = lazy(() =>
  import("./TotpSetupPanel").then((m) => ({ default: m.TotpSetupPanel })),
);
import { SetPasswordPanel } from "./SetPasswordPanel";
import { loginSchema, type LoginValues } from "./schemas";
import { useSession } from "./useSession";
import { useLoginMutation } from "./useAuthMutations";

const LANGUAGE_OPTIONS = [
  { value: "ru", label: "RU" },
  { value: "uz", label: "UZ" },
  { value: "en", label: "EN" },
] as const;

export function LoginPage({
  initialEmail,
}: {
  /** Почта только что заведённой учётной записи (`/login?email=`). */
  initialEmail?: string;
} = {}) {
  const { t, i18n } = useTranslation(["auth", "common"]);
  const { signIn } = useSession();
  const login = useLoginMutation();
  const { theme, setTheme } = useTheme();

  const currentLang =
    (i18n.language?.slice(0, 2) as "ru" | "uz" | "en") || "ru";

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
  /**
   * Второй фактор настраивался, но его секрет непригоден (записан мимо
   * приложения). Код из приложения не сойдётся никогда, поэтому предлагать его
   * нельзя: это отправляло бы человека по кругу. Ключ здесь один — резервный
   * код, и переключателя обратно нет.
   */
  const [factorBroken, setFactorBroken] = useState(false);

  const {
    register,
    handleSubmit,
    setFocus,
    watch,
    formState: { errors, submitCount },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: initialEmail ?? "" },
  });

  // Поле кода появляется после шага пароля — и фокус уходит в него. Без этого
  // человек с клавиатуры или со скринридером оставался на кнопке «Войти» и о
  // новом поле узнавал, только пройдя форму заново (правило П21 канона).
  const codeField = totpRequired
    ? useBackupCode
      ? "backupCode"
      : "totpCode"
    : null;
  useEffect(() => {
    if (codeField !== null) setFocus(codeField);
  }, [codeField, setFocus]);

  const emailError = errors.email && t("login.emailInvalid");
  const passwordError = errors.password && t("login.passwordRequired");

  // Шаг входа истёк — назад к форме: сервер выдаст новый токен шага.
  const restart = () => {
    setSetupToken(null);
    setResetToken(null);
    login.reset();
  };

  if (setupToken !== null) {
    return (
      <Suspense fallback={null}>
        <TotpSetupPanel setupToken={setupToken} onRestart={restart} />
      </Suspense>
    );
  }

  if (resetToken !== null) {
    return <SetPasswordPanel resetToken={resetToken} onRestart={restart} />;
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
      if (data.status === "totp_recovery_required") {
        // Отдельное состояние, а не разновидность `totp_required`: спрашивать
        // код из приложения здесь бессмысленно. Токена настройки сервер не даёт
        // намеренно — один пароль не должен открывать перенастройку фактора.
        setTotpRequired(true);
        setUseBackupCode(true);
        setFactorBroken(true);
        return;
      }
      if (data.status === "totp_required") {
        if (factorBroken) {
          // Прежний адрес был сломанной учёткой, этот — нет. Без сброса человек
          // со здоровым фактором читал бы, что его фактор повреждён, и сжигал
          // одноразовый резервный код вместо кода из приложения.
          setFactorBroken(false);
          setUseBackupCode(false);
        }
        // Второй фактор настроен и обязателен: сервер сообщает это СОСТОЯНИЕМ,
        // а не ошибкой. Раньше кабинет узнавал о нём, ловя 401, и показывал
        // «Неверный код подтверждения.» человеку, который кода ещё не вводил,
        // — на первом же экране, вслух для скринридера (`role="alert"`) и с
        // записью `login_failed_totp` в журнал аудита на каждый вход врача.
        setTotpRequired(true);
        return;
      }
      if (data.tokens?.access_token) {
        // Переход в кабинет делает guard маршрута: App перевычисляет его,
        // как только в контексте появляется сессия.
        signIn(data.tokens.access_token);
      }
    } catch {
      // Ошибку показывает форма: `login.error` попадает в сводку над кнопкой.
      // Своего разбора здесь нет намеренно — догадка кабинета о том, что
      // означает отказ, и была источником ложного обвинения.
    }
  });

  const watchedEmail = watch("email");

  return (
    <div className="flex min-h-dvh items-center justify-center p-screen">
      <div className="flex w-full max-w-form flex-col gap-section">
        {/* Шапка с логотипом, переключателем языка и темы */}
        <div className="flex items-center justify-between gap-field">
          <div className="flex items-center gap-field">
            <span
              aria-hidden="true"
              className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-kc-sm"
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

          <div className="flex items-center gap-2">
            <SegmentedControl
              label={t("login.languageLabel")}
              size="sm"
              value={currentLang}
              items={LANGUAGE_OPTIONS}
              onChange={(val) => {
                void i18n.changeLanguage(val);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-touch min-w-11 text-muted-foreground hover:text-foreground"
              aria-label={t("theme.toggle", { ns: "common" })}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </Button>
          </div>
        </div>

        <Card className="shadow-kc">
          <CardHeader>
            <CardTitle className="text-page-title">
              <h1 className="m-0 font-semibold">
                {totpRequired ? t("login.totpStepTitle") : t("login.title")}
              </h1>
            </CardTitle>
            <CardDescription>
              {totpRequired ? t("login.totpStepIntro") : t("login.intro")}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form
              onSubmit={onSubmit}
              noValidate
              className="flex flex-col gap-section"
            >
              <FormErrorSummary
                items={errorSummaryItems(submitCount, [
                  ["email", emailError],
                  ["password", passwordError],
                ])}
                focusKey={submitCount}
              />

              {/* Поля email и password остаются в DOM, чтобы react-hook-form передавала их значения на шаге 2FA */}
              <div className={totpRequired ? "hidden" : "contents"}>
                <Field
                  id="email"
                  type="email"
                  // Менеджеры паролей узнают поле по autoComplete; вставка ничем
                  // не ограничивается (правило П21 канона).
                  autoComplete="username"
                  label={t("login.email")}
                  error={emailError}
                  {...register("email")}
                />

                <Field
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  label={t("login.password")}
                  error={passwordError}
                  {...register("password")}
                />
              </div>

              {totpRequired && (
                <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/50 px-3.5 py-2.5 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <ShieldCheck className="size-4 shrink-0 text-primary" />
                    <span className="truncate font-medium text-foreground">
                      {watchedEmail || initialEmail}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-touch text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setTotpRequired(false);
                      setUseBackupCode(false);
                      login.reset();
                    }}
                  >
                    <ArrowLeft className="mr-1 size-3.5" />
                    {t("login.backToLogin")}
                  </Button>
                </div>
              )}

              {factorBroken && (
                <WarningBanner level="warning" title={t("login.brokenTitle")}>
                  {t("login.broken")}
                </WarningBanner>
              )}

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
                    width="full"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    label={t("login.totpCode")}
                    hint={t("login.totpHint")}
                    className="text-center font-mono text-2xl tracking-widest tabular-nums"
                    {...register("totpCode")}
                  />
                ))}

              {totpRequired && !factorBroken && (
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
        {!totpRequired && (
          <div className="rounded-2xl border border-border bg-card p-5 shadow-kc-sm">
            <div className="flex items-start gap-3.5">
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary"
              >
                <KeyRound className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-semibold text-foreground">
                  {t("login.noAccountTitle")}
                </p>
                <p className="m-0 mt-1 text-sm text-muted-foreground leading-relaxed">
                  {t("login.noAccount")}
                </p>
                <div className="mt-4">
                  <a
                    href="/join"
                    className="inline-flex min-h-touch items-center justify-center rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("login.haveCode")}
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
