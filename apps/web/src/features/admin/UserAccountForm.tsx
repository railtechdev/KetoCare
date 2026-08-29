import { zodResolver } from "@hookform/resolvers/zod";
import { FormFooter, Section } from "@ketocare/ui";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { ROLES } from "../auth/roles";
import { SelectField } from "../../components/Field";
import {
  FormErrorSummary,
  type FormErrorSummaryItem,
} from "./FormErrorSummary";
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
    formState: { errors, submitCount },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: { role: user.role, isActive: user.is_active },
    // Правило П8: проверка по уходу с поля, а не во время выбора.
    mode: "onBlur",
    reValidateMode: "onBlur",
  });

  const activeId = `${ids}-active`;
  const roleId = `${ids}-role`;

  const roleError = errors.role && t("users.form.errors.role");

  // Сводка над формой появляется только после неудачной отправки (правило П8).
  const summary: FormErrorSummaryItem[] =
    submitCount === 0 || roleError === undefined
      ? []
      : [{ fieldId: roleId, message: roleError }];

  return (
    <form
      noValidate
      className="flex flex-col gap-block"
      onSubmit={handleSubmit((values) =>
        onSubmit({ role: values.role, is_active: values.isActive }),
      )}
    >
      <FormErrorSummary
        title={t("errorSummary.title")}
        items={summary}
        focusKey={submitCount}
      />

      <Section
        title={t("users.form.title", { name: user.full_name })}
        description={user.email}
      >
        {error !== null && error !== undefined && (
          <FormError>
            {errorMessageOf(error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        <SelectField
          id={roleId}
          label={t("users.form.role")}
          error={roleError}
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
          className="flex min-h-touch items-center gap-field text-sm font-medium"
        >
          <input
            id={activeId}
            type="checkbox"
            className="size-5 accent-primary"
            {...register("isActive")}
          />
          {t("users.form.isActive")}
        </label>

        <FormFooter
          submitLabel={t("common:actions.save")}
          pendingLabel={t("common:actions.saving")}
          pending={pending}
          cancelLabel={t("common:actions.cancel")}
          onCancel={onCancel}
        />
      </Section>
    </form>
  );
}
