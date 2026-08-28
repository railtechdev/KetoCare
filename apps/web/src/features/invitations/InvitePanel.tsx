import { WarningBanner } from "@ketocare/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field, SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { SubmitButton } from "../../components/SubmitButton";
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
  const [copied, setCopied] = useState(false);

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
    <section className="rounded-kc border border-line p-4">
      <h3 className="mt-0 mb-1 text-base font-semibold">{t("title")}</h3>
      <p className="mt-0 mb-4 text-sm text-muted">{t("intro")}</p>

      <form
        onSubmit={handleSubmit((values) => {
          setCopied(false);
          invite.mutate(values, {
            onSuccess: () => reset({ email: "", role: values.role }),
          });
        })}
        noValidate
        className="max-w-lg"
      >
        <Field
          id={`${ids}-email`}
          type="email"
          autoComplete="off"
          label={t("fields.email")}
          error={errors.email && t("errors.email")}
          {...register("email")}
        />

        {roles.length > 1 ? (
          <SelectField
            id={`${ids}-role`}
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

        <SubmitButton pending={invite.isPending}>{t("submit")}</SubmitButton>
      </form>

      {link !== null && (
        <WarningBanner className="mt-4" level="info" title={t("ready.title")}>
          <p className="m-0">
            {t("ready.body", { email: invite.data?.email })}
          </p>
          <code className="mt-2 block rounded-lg border border-line bg-canvas px-3 py-2.5 break-all">
            {link}
          </code>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(link)
                  .then(() => setCopied(true));
              }}
              className="min-h-touch rounded-lg border border-line px-4 text-ink"
            >
              {t("ready.copy")}
            </button>
            {copied && (
              <span role="status" className="text-sm text-success">
                {t("ready.copied")}
              </span>
            )}
          </div>
          <p className="mt-2 mb-0 text-sm text-muted">
            {t("ready.oncePerToken")}
          </p>
        </WarningBanner>
      )}
    </section>
  );
}
