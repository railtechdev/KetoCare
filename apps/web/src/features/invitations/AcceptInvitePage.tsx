import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { SubmitButton } from "../../components/SubmitButton";
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
      <Shell title={t("accept.title")}>
        <p className="m-0 text-muted">{t("accept.noToken")}</p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell title={t("accept.doneTitle")}>
        <p className="m-0 text-muted">{t("accept.doneBody")}</p>
        <button
          type="button"
          onClick={() => void navigate({ to: "/login" })}
          className="mt-4 min-h-touch rounded-lg bg-accent px-4 font-semibold text-on-accent"
        >
          {t("accept.toLogin")}
        </button>
      </Shell>
    );
  }

  return (
    <Shell title={t("accept.title")}>
      <p className="mt-0 mb-6 text-muted">{t("accept.intro")}</p>

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
          label={t("accept.fields.phone")}
          {...register("phone")}
        />
        <Field
          id="invite-password"
          type="password"
          autoComplete="new-password"
          label={t("accept.fields.password")}
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

        <SubmitButton pending={accept.isPending}>
          {t("accept.submit")}
        </SubmitButton>
      </form>
    </Shell>
  );
}

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-md rounded-kc bg-surface p-8 shadow-kc">
        <h1 className="mb-2 text-2xl font-semibold">{title}</h1>
        {children}
      </section>
    </div>
  );
}
