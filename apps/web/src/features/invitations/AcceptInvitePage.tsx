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

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import {
  AccountFields,
  accountShape,
  withPasswordMatch,
} from "../auth/accountFields";
import { useAcceptInvitationMutation } from "./useInvitations";

// Поля и правила — общие с активацией кода доступа (`features/auth/accountFields`):
// оба пути заводят одну и ту же учётную запись, и разные требования к паролю на
// них были бы разницей без причины.
const acceptSchema = withPasswordMatch(z.object({ ...accountShape }));

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
    // Ссылка из мессенджера часто приходит обрезанной. Карточка без единой
    // кнопки оставляла человека в тупике — при том что рядом, в состоянии
    // «готово», кнопка «Войти» уже была (правило П15 канона).
    return (
      <Shell title={t("accept.title")} description={t("accept.noToken")}>
        <Button type="button" onClick={() => void navigate({ to: "/login" })}>
          {t("accept.toLogin")}
        </Button>
      </Shell>
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
        <AccountFields register={register} errors={errors} idPrefix="invite" />

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
