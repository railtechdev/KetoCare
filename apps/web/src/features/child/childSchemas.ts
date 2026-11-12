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
/** Границы те же, что у записи веса в API (`WEIGHT_MIN_KG`, `WEIGHT_MAX_KG`). */
const WEIGHT_MIN_KG = 2;
const WEIGHT_MAX_KG = 150;

export const childSchema = z.object({
  fullName: z.string().trim().min(1).max(255),
  birthDate: z.string().refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)),
  sex: z.enum(["m", "f"]),
  heightCm: z
    .string()
    .refine((value) => value.trim() === "" || isPlausibleHeight(value)),
  weightKg: z
    .string()
    .refine((value) => value.trim() === "" || isPlausibleWeight(value)),
  allergies: z.string(),
  /**
   * Исключённые продукты каталога — идентификаторами.
   *
   * Свободная метка («орехи») остаётся в `allergies`: сопоставить её с
   * каталогом нечем. А вот конкретный продукт обязан быть ссылкой — иначе ни
   * подбор раскладки, ни меню о нём не узнают, и ребёнку с аллергией на арахис
   * решатель предложит арахисовое масло (раздел 6.3 ТЗ).
   */
  excludedProductIds: z.array(z.string()),
  notes: z.string(),
});

/**
 * Новая карта: рост и вес обязательны (замечание диетолога 12.11.2026). По весу
 * и возрасту считаются подсказки калорийности, белка и жидкости в назначении,
 * по росту — оценка роста по ВОЗ; карта без них открывала назначение пустым.
 * При правке карты вес не вводится (дальше он идёт в дневник), а рост,
 * пропущенный в старой карте, не мешает поправить остальное.
 */
export const newChildSchema = childSchema.extend({
  heightCm: z.string().refine(isPlausibleHeight),
  weightKg: z.string().refine(isPlausibleWeight),
});

export type ChildValues = z.infer<typeof childSchema>;

function isPlausibleWeight(value: string): boolean {
  const weight = Number(value.replace(",", "."));
  return (
    Number.isFinite(weight) &&
    weight >= WEIGHT_MIN_KG &&
    weight <= WEIGHT_MAX_KG
  );
}

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

/** Строка похожа на идентификатор продукта, а не на свободную метку? */
export function looksLikeProductId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

/**
 * Хранимое поле `allergies` → значения формы.
 *
 * Поле хранит и идентификаторы продуктов, и свободные метки (раздел 4.2 ТЗ).
 * Разбор идёт по тому же правилу, что и на сервере: другое правило означало бы,
 * что часть системы считает исключение меткой, а часть — продуктом.
 */
export function splitExclusions(allergies: readonly string[]): {
  productIds: string[];
  labels: string[];
} {
  const productIds: string[] = [];
  const labels: string[] = [];
  for (const entry of allergies) {
    const value = entry.trim();
    if (value === "") continue;
    if (looksLikeProductId(value)) productIds.push(value);
    else labels.push(value);
  }
  return { productIds, labels };
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
  const weight = optional(values.weightKg);
  return {
    full_name: values.fullName.trim(),
    birth_date: values.birthDate,
    sex: values.sex,
    height_cm: height === null ? null : Number(height),
    // weight:raw — тело запроса, а не показ
    weight_kg: weight === null ? null : Number(weight.replace(",", ".")),
    // Продукты идут первыми: порядок сохраняется как есть, и в карточке
    // сначала видно то, что сопоставлено с каталогом.
    allergies: [
      ...values.excludedProductIds,
      ...parseAllergies(values.allergies),
    ],
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
  // Weight is a diary entry written once at creation, not a field of the card.
  const { full_name, height_cm, allergies, notes } = toChildBody(values);
  return { full_name, height_cm, allergies, notes };
}
