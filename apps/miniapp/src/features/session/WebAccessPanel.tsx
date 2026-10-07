import { Button, FieldShell, Input, Section, toast } from "@ketocare/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { BreakableUrl, ExternalLink } from "../../components/ExternalLink";
import { api, errorMessageOf } from "../../lib/api";
import { launchData } from "../../lib/telegram";
import { useTelegramBack, useUnsavedGuard } from "../../lib/useTelegram";
import { type Session, useUpdateSession } from "./useSession";

/**
 * «Вход в кабинет» — включение веба родителю, пришедшему из Telegram (ADR-0040).
 *
 * Блок на главной, а не седьмая вкладка: шесть вкладок — потолок нижней полосы
 * (на 360 px это уже по 60 px на вкладку), и разовое действие не стоит того,
 * чтобы занимать место у ежедневных.
 *
 * Показывается по признаку с сервера (`has_web_credentials`), а не по своей
 * догадке: экран, решающий сам, однажды предложил бы то, что кончится 409.
 * После успеха форма уступает место адресу кабинета — предлагать сделанное
 * значит врать, а молча исчезнуть значит бросить человека на полпути.
 */
export function WebAccessPanel({ session }: { session: Session }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const updateSession = useUpdateSession();
  useUnsavedGuard(!done && (email !== "" || password !== ""));

  const enable = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/v1/users/me/credentials", {
        body: { email, password },
      });
      if (error || !data)
        throw error ?? new Error("Empty credentials response");
      return data;
    },
    onSuccess: () => {
      setDone(true);
      // Сессия знает о кабинете сразу, а не после перезапуска: иначе другие
      // экраны (ссылка на кабинет в плане дня) и этот же блок после смены
      // ребёнка снова предлагали бы включить сделанное.
      updateSession({ hasWebCredentials: true });
      toast.success(t("webAccess.done"));
    },
  });

  // После включения блок не исчезает молча, а говорит, куда идти дальше:
  // «включено» без адреса — поручение без места назначения (аудит пути,
  // 02.10.2026). Проверка до `hasWebCredentials`: сессия уже знает о кабинете,
  // но подсказку «куда идти» человек должен успеть прочесть.
  if (done)
    return (
      <Section title={t("webAccess.title")} density="compact">
        <p className="m-0">{t("webAccess.doneHint")}</p>
        <ExternalLink
          className="underline underline-offset-4"
          href={session.webUrl}
        >
          <BreakableUrl url={session.webUrl} />
        </ExternalLink>
      </Section>
    );

  if (session.hasWebCredentials) return <WebPasswordReset session={session} />;

  return (
    <Section title={t("webAccess.title")} density="compact">
      <p className="m-0 text-muted-foreground">{t("webAccess.intro")}</p>

      <form
        className="flex flex-col gap-field"
        onSubmit={(event) => {
          event.preventDefault();
          enable.mutate();
        }}
      >
        <FieldShell label={t("webAccess.email")}>
          {() => (
            <Input
              type="email"
              required
              autoComplete="email"
              className="min-h-touch"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </FieldShell>

        {/* Требование к длине называется до отправки, а не в отказе: оно
            одно и то же во всех трёх дверях в кабинет. Пояснением рядом с
            полем, а не внутри подписи — иначе оно читалось бы как имя поля. */}
        <FieldShell
          label={t("webAccess.password")}
          hint={t("webAccess.passwordHint")}
        >
          {({ describedBy }) => (
            <Input
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              className="min-h-touch"
              aria-describedby={describedBy}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </FieldShell>

        {enable.isError && (
          <p role="alert" className="m-0 text-destructive">
            {errorMessageOf(enable.error) ?? t("webAccess.failed")}
          </p>
        )}

        {/* Второстепенное на главной: громкая кнопка одна на экран (П31). */}
        <Button
          type="submit"
          variant="outline"
          className="min-h-touch self-start"
          disabled={enable.isPending}
        >
          {enable.isPending ? t("webAccess.saving") : t("webAccess.submit")}
        </Button>
      </form>

      <p className="m-0 text-sm text-muted-foreground">
        {t("webAccess.where")}{" "}
        <ExternalLink
          className="underline underline-offset-4"
          href={session.webUrl}
        >
          <BreakableUrl url={session.webUrl} />
        </ExternalLink>
      </p>
    </Section>
  );
}

/**
 * Кабинет уже включён: адрес под рукой и сброс забытого пароля (аудит, E3).
 *
 * Прежде забытый пароль сбрасывал только администратор клиники, хотя личность
 * родителя уже подтверждает Telegram. Почту отсюда не сменить — только
 * пароль; во все чаты владельца приходит сообщение о смене. После смены
 * прежние сессии обрываются, и приложение открывает свою заново.
 */
function WebPasswordReset({ session }: { session: Session }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");

  const reset = useMutation({
    mutationFn: async () => {
      // Свежая подпись Telegram — повторная проверка, что телефон в руках
      // владельца (ADR-0051). Без строки запуска сервер откажет понятным
      // «закройте приложение и откройте снова».
      const { error } = await api.POST("/api/v1/users/me/credentials/reset", {
        body: { password, init_data: launchData() ?? "" },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("webAccess.reset.done"));
      // Сессия приложения несёт отметку прежнего пароля и больше не годится:
      // перезапуск открывает новую по той же подписи Telegram.
      window.setTimeout(() => window.location.reload(), 1500);
    },
  });

  // Открытая форма сброса — вложенное состояние: «Назад» Telegram её
  // сворачивает, а не закрывает приложение; набранный пароль бережёт
  // подтверждение закрытия.
  useTelegramBack(
    open && !reset.isPending
      ? () => {
          setOpen(false);
          setPassword("");
        }
      : null,
  );
  useUnsavedGuard(open && password !== "");

  return (
    <Section title={t("webAccess.title")} density="compact">
      <p className="m-0 text-sm text-muted-foreground">
        {t("webAccess.where")}{" "}
        <ExternalLink
          className="underline underline-offset-4"
          href={session.webUrl}
        >
          <BreakableUrl url={session.webUrl} />
        </ExternalLink>
      </p>

      {!open ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-touch self-start"
          onClick={() => setOpen(true)}
        >
          {t("webAccess.reset.open")}
        </Button>
      ) : (
        <form
          className="flex flex-col gap-field"
          onSubmit={(event) => {
            event.preventDefault();
            reset.mutate();
          }}
        >
          <p className="m-0 text-sm text-muted-foreground">
            {t("webAccess.reset.intro")}
          </p>
          <FieldShell
            label={t("webAccess.reset.password")}
            hint={t("webAccess.passwordHint")}
          >
            {({ describedBy }) => (
              <Input
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                className="min-h-touch"
                aria-describedby={describedBy}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </FieldShell>
          {reset.isError && (
            <p role="alert" className="m-0 text-destructive">
              {errorMessageOf(reset.error) ?? t("webAccess.failed")}
            </p>
          )}
          <Button
            type="submit"
            variant="outline"
            className="min-h-touch self-start"
            disabled={reset.isPending}
          >
            {reset.isPending
              ? t("webAccess.saving")
              : t("webAccess.reset.submit")}
          </Button>
        </form>
      )}
    </Section>
  );
}
