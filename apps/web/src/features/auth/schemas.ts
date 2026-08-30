import { z } from "zod";

/**
 * Схемы форм аутентификации (раздел 3 ТЗ: react-hook-form + zod).
 *
 * Проверяют только форму ввода. Содержательные ограничения (длина пароля,
 * корректность кода) остаются за сервером: клиентская проверка — это подсказка
 * пользователю, а не защита.
 */
export const loginSchema = z.object({
  email: z.string().min(1).email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
  /** Резервный код вместо кода приложения, когда телефон недоступен */
  backupCode: z.string().optional(),
});

export type LoginValues = z.infer<typeof loginSchema>;

export const totpVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6,8}$/),
});

export type TotpVerifyValues = z.infer<typeof totpVerifySchema>;
