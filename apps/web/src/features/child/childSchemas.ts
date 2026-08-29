import { z } from "zod";

/**
 * Границы формы ребёнка.
 *
 * Повторяют серверную схему (`apps/api/src/api/schemas.py`), а не задают свои:
 * клиентская проверка нужна, чтобы не гонять заведомо неверный запрос, решение
 * всё равно за сервером. Медицинского здесь ничего нет — рост и дата рождения
 * не пороги терапии, а границы правдоподобия.
 */
export const HEIGHT_MIN_CM = 0;
export const HEIGHT_MAX_CM = 250;

/**
 * Схема проверяет, но не преобразует: поля остаются строками, какими их отдаёт
 * браузер. Так вход и выход схемы совпадают.
 *
 * Преобразование жило в схеме и ломало форму: `zodResolver` отдавал уже
 * разобранные значения, сборка тела запроса разбирала их второй раз и падала на
 * собственном результате — рост приходил числом там, где ждали строку. Форма при
 * этом молча не отправлялась и ошибки не показывала.
 */
export const childSchema = z.object({
  fullName: z.string().trim().min(1).max(255),
  birthDate: z.string().refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)),
  sex: z.enum(["m", "f"]),
  heightCm: z
    .string()
    .refine((value) => value.trim() === "" || isPlausibleHeight(value)),
  allergies: z.string(),
  notes: z.string(),
});

export type ChildValues = z.infer<typeof childSchema>;

function isPlausibleHeight(value: string): boolean {
  const height = Number(value);
  return (
    Number.isFinite(height) && height > HEIGHT_MIN_CM && height <= HEIGHT_MAX_CM
  );
}

/** Пустое необязательное поле — это «не указано», а не ноль и не пустая строка. */
function optional(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

/**
 * Аллергии вводятся строкой через запятую: отдельное поле на каждую превратило
 * бы форму в десять строк там, где нужна одна.
 */
export function parseAllergies(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** Значения формы → тело создания. */
export function toChildBody(values: ChildValues) {
  const height = optional(values.heightCm);
  return {
    full_name: values.fullName.trim(),
    birth_date: values.birthDate,
    sex: values.sex,
    height_cm: height === null ? null : Number(height),
    allergies: parseAllergies(values.allergies),
    notes: optional(values.notes),
  };
}

/**
 * Тело правки: только изменяемые поля.
 *
 * Дата рождения и пол не отправляются вовсе — они уже вошли в сделанные расчёты
 * и отчёты, и правка переписала бы возраст задним числом. Сервер их тоже не
 * принимает, но полагаться здесь на чужую проверку значило бы зависеть от того,
 * что схема на сервере не изменится.
 */
export function toChildUpdateBody(values: ChildValues) {
  const { full_name, height_cm, allergies, notes } = toChildBody(values);
  return { full_name, height_cm, allergies, notes };
}
