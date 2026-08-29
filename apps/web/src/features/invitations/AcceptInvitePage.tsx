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
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { useAcceptInvitationMutation } from "./useInvitations";

/** Минимум пароля повторяет серверную схему (`InvitationAccept`). */
export const PASSWORD_MIN_LENGTH = 12;

const acceptSchema = z
  .object({
    fullName: z.string().trim().min(1).max(255),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
    passwordRepeat: z.string(),
    phone: z.string(),
  })
  .refine((values) => values.password === values.passwordRepeat, {
    path: ["passwordRepeat"],
    message: "mismatch",
  });

type AcceptValues = z.infer<typeof acceptSchema>;

/**
 * Принятие приглашения — единственный способ завести учётную запись.
 *
 * Страница публичная: приглашённого пользователя ещё не существует. Токен из
 * адреса проверяет сервер; здесь он не разбирается и ничего о нём не
 * утверждается — «недействительно или истекло» приходит одним сообщением, чтобы
 * подбор токенов не отличал «нет такого» от «уже принято».
 */
export function AcceptInvitePage() {
  const { t } = useTranslation("invitations");
  const search = useSearch({ from: "/invite" });
  const navigate = useNavigate();
  const accept = useAcceptInvitationMutation();
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AcceptValues>({
    resolver: zodResolver(acceptSchema),
    defaultValues: {
      fullName: "",
      password: "",
      passwordRepeat: "",
      phone: "",
    },
  });

  const token = search.token ?? "";

  if (token === "") {
    return (
      <Shell title={t("accept.title")} description={t("accept.noToken")} />
    );
  }

  if (done) {
    return (
      <Shell title={t("accept.doneTitle")} description={t("accept.doneBody")}>
        <Button type="button" onClick={() => void navigate({ to: "/login" })}>
          {t("accept.toLogin")}
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title={t("accept.title")} description={t("accept.intro")}>
      <form
        onSubmit={handleSubmit((values) => {
          accept.mutate(
            {
              token,
              full_name: values.fullName,
              password: values.password,
              phone: values.phone.trim() === "" ? null : values.phone.trim(),
            },
            { onSuccess: () => setDone(true) },
          );
        })}
        noValidate
        className="flex flex-col gap-block"
      >
        <Field
          id="invite-name"
          autoComplete="name"
          label={t("accept.fields.fullName")}
          error={errors.fullName && t("accept.errors.fullName")}
          {...register("fullName")}
        />
        <Field
          id="invite-phone"
          type="tel"
          autoComplete="tel"
          optional
          label={t("accept.fields.phone")}
          {...register("phone")}
        />
        <Field
          id="invite-password"
          type="password"
          // new-password: менеджер паролей предложит сгенерировать и вставить
          // пароль, вставка ничем не ограничивается (правило П21 канона).
          autoComplete="new-password"
          label={t("accept.fields.password")}
          hint={t("accept.hints.password", { min: PASSWORD_MIN_LENGTH })}
          error={
            errors.password &&
            t("accept.errors.password", { min: PASSWORD_MIN_LENGTH })
          }
          {...register("password")}
        />
        <Field
          id="invite-password-repeat"
          type="password"
          autoComplete="new-password"
          label={t("accept.fields.passwordRepeat")}
          error={errors.passwordRepeat && t("accept.errors.passwordRepeat")}
          {...register("passwordRepeat")}
        />

        {accept.error !== null && (
          <FormError>
            {errorMessageOf(accept.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <FormFooter
          submitLabel={t("accept.submit")}
          pendingLabel={t("accept.submitting")}
          pending={accept.isPending}
        />
      </form>
    </Shell>
  );
}

/**
 * Каркас публичной страницы: кабинета ещё нет, поэтому `PageLayout` здесь не
 * применяется — карточка по центру пустого экрана, как и на входе.
 */
function Shell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-screen">
      <Card className="w-full max-w-form">
        <CardHeader>
          <CardTitle className="text-page-title">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children && <CardContent>{children}</CardContent>}
      </Card>
    </div>
  );
}
