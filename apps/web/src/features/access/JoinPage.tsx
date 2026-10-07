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
import {
  FormErrorSummary,
  errorSummaryItems,
} from "../../components/FormErrorSummary";
import { api, errorMessageOf } from "../../lib/api";
import {
  AccountFields,
  useAccountErrorEntries,
  accountShape,
  withPasswordMatch,
} from "../auth/accountFields";
import { useMutation } from "@tanstack/react-query";

const joinSchema = withPasswordMatch(
  z.object({
    code: z.string().trim().min(1).max(16),
    email: z.string().trim().email(),
    ...accountShape,
  }),
);

type JoinValues = z.infer<typeof joinSchema>;

/**
 * Активация кода доступа семьёй (ADR-0040).
 *
 * Публичный маршрут, как и принятие приглашения: человека, который сюда
 * приходит, ещё не существует. Код проверяет сервер — здесь он не разбирается
 * и ничего о нём не утверждается: «недействителен или истёк» приходит одним
 * сообщением, чтобы подбор не отличал «нет такого» от «уже использован».
 *
 * Код подставляется из адреса: семья приходит по ссылке или по QR, и набирать
 * восемь знаков ей незачем. Поле всё равно показывается — ссылка из мессенджера
 * часто приходит обрезанной, и тогда код вводят с листка.
 */
export function JoinPage() {
  const { t } = useTranslation("access");
  const search = useSearch({ from: "/join" });
  const navigate = useNavigate();
  // Почта заведённой учётной записи: она уезжает на вход, чтобы не набирать
  // её второй раз. `null` — ещё не заведена.
  const [done, setDone] = useState<string | null>(null);

  const join = useMutation({
    mutationFn: async (values: JoinValues) => {
      const { data, error } = await api.POST(
        "/api/v1/auth/access-codes/activate",
        {
          body: {
            code: values.code.trim(),
            email: values.email.trim(),
            full_name: values.fullName,
            password: values.password,
            phone: values.phone.trim() === "" ? null : values.phone.trim(),
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty activate response");
      return data;
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors, submitCount },
  } = useForm<JoinValues>({
    resolver: zodResolver(joinSchema),
    defaultValues: {
      code: search.code ?? "",
      email: "",
      fullName: "",
      password: "",
      passwordRepeat: "",
      phone: "",
    },
  });

  const codeError = errors.code && t("join.codeRequired");
  const emailError = errors.email && t("invitations:errors.email");
  const accountErrors = useAccountErrorEntries(errors, "join");

  if (done !== null) {
    return (
      <Shell
        title={t("join.doneTitle")}
        description={t("join.doneDescription")}
      >
        <Button
          type="button"
          onClick={() =>
            void navigate({ to: "/login", search: { email: done } })
          }
        >
          {t("join.toLogin")}
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title={t("join.title")} description={t("join.intro")}>
      {/* Почта и пароль — не единственный путь: семья, у которой есть
          Telegram, подключается ботом в одно нажатие. Сказать об этом здесь,
          а не оставить человека заполнять форму, которая ему не нужна. */}
      <p className="m-0 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        {t("join.telegramHint")}
      </p>
      <form
        onSubmit={handleSubmit((values) => {
          join.mutate(values, {
            onSuccess: () => setDone(values.email.trim()),
          });
        })}
        noValidate
        className="flex flex-col gap-section"
      >
        <FormErrorSummary
          items={errorSummaryItems(submitCount, [
            ["join-code", codeError],
            ["join-email", emailError],
            ...accountErrors,
          ])}
          focusKey={submitCount}
        />
        <Field
          id="join-code"
          width="medium"
          autoComplete="one-time-code"
          label={t("join.code")}
          hint={t("join.codeHint")}
          error={codeError}
          {...register("code")}
        />
        <Field
          id="join-email"
          type="email"
          autoComplete="username"
          label={t("invitations:fields.email")}
          error={emailError}
          {...register("email")}
        />

        <AccountFields register={register} errors={errors} idPrefix="join" />

        {join.error !== null && (
          <FormError>
            {errorMessageOf(join.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <FormFooter
          submitLabel={t("join.submit")}
          pendingLabel={t("join.submitting")}
          pending={join.isPending}
        />
      </form>
    </Shell>
  );
}

/** Каркас публичной страницы — тот же, что у принятия приглашения. */
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
    <div className="flex min-h-dvh items-center justify-center p-screen">
      <Card className="w-full max-w-form">
        <CardHeader>
          <CardTitle className="text-page-title">
            <h1 className="m-0 font-semibold">{title}</h1>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children && <CardContent>{children}</CardContent>}
      </Card>
    </div>
  );
}
