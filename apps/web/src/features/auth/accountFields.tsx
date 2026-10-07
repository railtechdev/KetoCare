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

/**
 * Ошибки полей учётной записи парами «id поля → текст» — для сводки ошибок
 * формы (правило П8). Тексты те же, что под полями: их считает одна функция.
 */
export function useAccountErrorEntries<T extends FieldValues>(
  errors: FieldErrors<T>,
  idPrefix: string,
): [string, string | undefined][] {
  const { t } = useTranslation("invitations");
  const messages = accountErrorMessages(t, errors);
  return [
    [`${idPrefix}-name`, messages.fullName],
    [`${idPrefix}-password`, messages.password],
    [`${idPrefix}-password-repeat`, messages.passwordRepeat],
  ];
}

function accountErrorMessages<T extends FieldValues>(
  t: (key: string, options?: Record<string, unknown>) => string,
  errors: FieldErrors<T>,
) {
  return {
    fullName: errors.fullName ? t("accept.errors.fullName") : undefined,
    password: errors.password
      ? t("accept.errors.password", { min: PASSWORD_MIN_LENGTH })
      : undefined,
    passwordRepeat: errors.passwordRepeat
      ? t("accept.errors.passwordRepeat")
      : undefined,
  };
}

export function AccountFields<T extends FieldValues>({
  register,
  errors,
  idPrefix,
}: AccountFieldsProps<T>) {
  // Тексты живут в словаре приглашений: они написаны для человека, который
  // заводит учётную запись, и на обоих путях он один и тот же.
  const { t } = useTranslation("invitations");
  const messages = accountErrorMessages(t, errors);

  return (
    <>
      <Field
        id={`${idPrefix}-name`}
        autoComplete="name"
        label={t("accept.fields.fullName")}
        error={messages.fullName}
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
        error={messages.password}
        {...register("password" as Path<T>)}
      />
      <Field
        id={`${idPrefix}-password-repeat`}
        width="medium"
        type="password"
        autoComplete="new-password"
        label={t("accept.fields.passwordRepeat")}
        error={messages.passwordRepeat}
        {...register("passwordRepeat" as Path<T>)}
      />
    </>
  );
}
