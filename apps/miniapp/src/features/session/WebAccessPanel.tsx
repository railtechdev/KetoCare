import { Button, Input, Section, toast } from "@ketocare/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { api, errorMessageOf } from "../../lib/api";
import type { Session } from "./useSession";

/**
 * «Вход в кабинет» — включение веба родителю, пришедшему из Telegram (ADR-0040).
 *
 * Блок на главной, а не седьмая вкладка: шесть вкладок — потолок нижней полосы
 * (на 360 px это уже по 60 px на вкладку), и разовое действие не стоит того,
 * чтобы занимать место у ежедневных.
 *
 * Показывается по признаку с сервера (`has_web_credentials`), а не по своей
 * догадке: экран, решающий сам, однажды предложил бы то, что кончится 409.
 * После успеха блок исчезает — предлагать сделанное значит врать.
 */
export function WebAccessPanel({ session }: { session: Session }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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
      toast.success(t("webAccess.done"));
    },
  });

  if (session.hasWebCredentials || done) return null;

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
        <label className="flex flex-col gap-1">
          <span>{t("webAccess.email")}</span>
          <Input
            type="email"
            required
            autoComplete="email"
            className="min-h-touch"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span>{t("webAccess.password")}</span>
          <Input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            className="min-h-touch"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {/* Требование к длине называется до отправки, а не в отказе: оно
              одно и то же во всех трёх дверях в кабинет. */}
          <span className="text-sm text-muted-foreground">
            {t("webAccess.passwordHint")}
          </span>
        </label>

        {enable.isError && (
          <p role="alert" className="m-0 text-destructive">
            {errorMessageOf(enable.error) ?? t("webAccess.failed")}
          </p>
        )}

        <Button
          type="submit"
          className="min-h-touch self-start"
          disabled={enable.isPending}
        >
          {enable.isPending ? t("webAccess.saving") : t("webAccess.submit")}
        </Button>
      </form>

      <p className="m-0 text-sm text-muted-foreground">
        {t("webAccess.where")}{" "}
        <a
          className="underline underline-offset-4"
          href={session.webUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {session.webUrl}
        </a>
      </p>
    </Section>
  );
}
