import {
  Button,
  FormFooter,
  Section,
  toast,
  WarningBanner,
} from "@ketocare/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy } from "lucide-react";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field, SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import {
  invitationLink,
  useCreateInvitationMutation,
  type Role,
} from "./useInvitations";

const inviteSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["admin", "doctor", "dietitian", "parent"]),
});

type InviteValues = z.infer<typeof inviteSchema>;

/**
 * Выдача приглашения.
 *
 * `roles` задаёт вызывающий экран: администратор зовёт персонал, врач и
 * диетолог — семьи (ADR-0003). Это оформление; сервер проверяет то же самое и
 * отвечает 403 на попытку позвать не ту роль.
 */
export function InvitePanel({ roles }: { roles: readonly Role[] }) {
  const { t } = useTranslation("invitations");
  const ids = useId();
  const invite = useCreateInvitationMutation();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: roles[0] },
  });

  const link =
    invite.data === undefined ? null : invitationLink(invite.data.token);

  return (
    <Section title={t("title")} description={t("intro")}>
      <form
        onSubmit={handleSubmit((values) => {
          invite.mutate(values, {
            onSuccess: () => reset({ email: "", role: values.role }),
          });
        })}
        noValidate
        className="flex max-w-form flex-col gap-block"
      >
        <Field
          id={`${ids}-email`}
          width="wide"
          type="email"
          autoComplete="off"
          label={t("fields.email")}
          error={errors.email && t("errors.email")}
          {...register("email")}
        />

        {roles.length > 1 ? (
          <SelectField
            id={`${ids}-role`}
            width="medium"
            label={t("fields.role")}
            {...register("role")}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {t(`common:roles.${role}`)}
              </option>
            ))}
          </SelectField>
        ) : (
          <input type="hidden" {...register("role")} />
        )}

        {invite.error !== null && (
          <FormError>
            {errorMessageOf(invite.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <FormFooter
          submitLabel={t("submit")}
          pendingLabel={t("submitting")}
          pending={invite.isPending}
        />
      </form>

      {/* Ссылка показывается один раз: она собрана из токена, который сервер
          больше не отдаст. Поэтому это не тост, а блок, который остаётся на
          экране, пока приглашение не создано заново. */}
      {link !== null && (
        <WarningBanner level="info" title={t("ready.title")}>
          <p className="m-0">
            {t("ready.body", { email: invite.data?.email })}
          </p>
          <code className="mt-field block rounded-lg border border-border bg-background px-3 py-2.5 break-all">
            {link}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-field"
            onClick={() => {
              void navigator.clipboard
                .writeText(link)
                .then(() => toast.success(t("ready.copied")));
            }}
          >
            <Copy aria-hidden="true" />
            {t("ready.copy")}
          </Button>
          <p className="mt-field mb-0 text-sm text-muted-foreground">
            {t("ready.oncePerToken")}
          </p>
        </WarningBanner>
      )}
    </Section>
  );
}
