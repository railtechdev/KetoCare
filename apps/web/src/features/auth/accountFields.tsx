import type {
  FieldErrors,
  FieldValues,
  UseFormRegister,
  Path,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field } from "../../components/Field";

/** Минимум пароля повторяет серверные схемы (`InvitationAccept`, `AccessCodeActivate`). */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Поля учётной записи, общие для двух путей её создания: принятие приглашения
 * (персонал) и активация кода доступа (семья).
 *
 * Вынесены потому, что путей стало два, а требования к паролю, подписи и тексты
 * ошибок обязаны совпадать: человек, пришедший разными дорогами, не должен
 * встречать разные правила. Копия этих ста строк разошлась бы молча — расходятся
 * они всегда в мелочи вроде `autoComplete` или длины пароля.
 */
export const accountShape = {
  fullName: z.string().trim().min(1).max(255),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
  passwordRepeat: z.string(),
  phone: z.string(),
};

/** Пароли совпадают — проверка одна на оба пути. */
export function withPasswordMatch<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
) {
  return schema.refine(
    (values) =>
      (values as { password: string; passwordRepeat: string }).password ===
      (values as { password: string; passwordRepeat: string }).passwordRepeat,
    { path: ["passwordRepeat"], message: "mismatch" },
  );
}

export interface AccountFieldsProps<T extends FieldValues> {
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
  /** Различает идентификаторы, когда на странице две формы. */
  idPrefix: string;
}

export function AccountFields<T extends FieldValues>({
  register,
  errors,
  idPrefix,
}: AccountFieldsProps<T>) {
  // Тексты живут в словаре приглашений: они написаны для человека, который
  // заводит учётную запись, и на обоих путях он один и тот же.
  const { t } = useTranslation("invitations");

  return (
    <>
      <Field
        id={`${idPrefix}-name`}
        autoComplete="name"
        label={t("accept.fields.fullName")}
        error={errors.fullName && t("accept.errors.fullName")}
        {...register("fullName" as Path<T>)}
      />
      <Field
        id={`${idPrefix}-phone`}
        width="medium"
        type="tel"
        autoComplete="tel"
        optional
        label={t("accept.fields.phone")}
        {...register("phone" as Path<T>)}
      />
      <Field
        id={`${idPrefix}-password`}
        width="medium"
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
        {...register("password" as Path<T>)}
      />
      <Field
        id={`${idPrefix}-password-repeat`}
        width="medium"
        type="password"
        autoComplete="new-password"
        label={t("accept.fields.passwordRepeat")}
        error={errors.passwordRepeat && t("accept.errors.passwordRepeat")}
        {...register("passwordRepeat" as Path<T>)}
      />
    </>
  );
}
