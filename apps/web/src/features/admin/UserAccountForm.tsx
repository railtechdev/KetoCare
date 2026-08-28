import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { FormError } from "../../components/FormError";
import { SubmitButton } from "../../components/SubmitButton";
import { errorMessageOf } from "../../lib/api";
import { ROLES } from "../auth/roles";
import { SelectField } from "../../components/Field";
import type { AdminUser, AdminUserUpdate } from "./types";

const accountFormSchema = z.object({
  role: z.enum(ROLES),
  isActive: z.boolean(),
});

type AccountFormValues = z.infer<typeof accountFormSchema>;

interface Props {
  user: AdminUser;
  pending: boolean;
  /** Ошибка мутации: сообщение приходит от сервера уже на русском */
  error: unknown;
  onSubmit: (changes: AdminUserUpdate) => void;
  onCancel: () => void;
}

/**
 * Правка роли и активности учётной записи (раздел 5.3 ТЗ).
 *
 * Отправляются оба поля, а не только изменённое: PATCH с полным набором
 * изменяемых полей даёт в `audit_log.before/after` читаемый снимок учётной
 * записи, по которому видно и то, что осталось прежним.
 */
export function UserAccountForm({
  user,
  pending,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useTranslation("admin");
  const ids = useId();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: { role: user.role, isActive: user.is_active },
  });

  const activeId = `${ids}-active`;

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) =>
        onSubmit({ role: values.role, is_active: values.isActive }),
      )}
      className="rounded-kc border border-line p-4"
    >
      <h3 className="mt-0 mb-1 text-base font-semibold">
        {t("users.form.title", { name: user.full_name })}
      </h3>
      <p className="mt-0 mb-4 text-sm text-muted">{user.email}</p>

      {error !== null && error !== undefined && (
        <FormError>
          {errorMessageOf(error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <SelectField
        id={`${ids}-role`}
        label={t("users.form.role")}
        error={errors.role && t("users.form.errors.role")}
        {...register("role")}
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {t(`common:roles.${role}`)}
          </option>
        ))}
      </SelectField>

      <label
        htmlFor={activeId}
        className="mb-4 flex min-h-touch items-center gap-3 text-sm font-medium"
      >
        <input
          id={activeId}
          type="checkbox"
          className="size-5 accent-accent"
          {...register("isActive")}
        />
        {t("users.form.isActive")}
      </label>

      <div className="flex gap-3">
        <SubmitButton pending={pending} className="max-w-48">
          {t("common:actions.save")}
        </SubmitButton>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-touch max-w-48 flex-1 rounded-lg border border-line px-4 text-ink"
        >
          {t("common:actions.cancel")}
        </button>
      </div>
    </form>
  );
}
