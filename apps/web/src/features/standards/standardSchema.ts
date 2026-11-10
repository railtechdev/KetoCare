import { z } from "zod";

import type {
  FoodStandard,
  FoodStandardCreateBody,
  FoodStandardUpdateBody,
} from "./useFoodStandards";

/**
 * Форма стандарта. Длины остаются за сервером: копия предела на клиенте
 * разошлась бы со схемой API. `net` здесь нет намеренно: сервер такой стандарт
 * не примет (ADR-0057).
 */
export const standardFormSchema = z.object({
  name: z.string().trim().min(1),
  publisher: z.string().trim(),
  document: z.string().trim(),
  version: z.string().trim(),
  effectiveOn: z.string(),
  kind: z.enum(["clinic", "reference"]),
  dietType: z.enum(["ketogenic", "general"]),
  carbsConvention: z.enum(["total", "unknown"]),
});

export type StandardFormValues = z.infer<typeof standardFormSchema>;

export const EMPTY_STANDARD_VALUES: StandardFormValues = {
  name: "",
  publisher: "",
  document: "",
  version: "",
  effectiveOn: "",
  kind: "clinic",
  dietType: "ketogenic",
  carbsConvention: "total",
};

/**
 * Описание прежней редакции — основа новой.
 *
 * Название и версия остаются пустыми: это как раз то, чем редакция отличается,
 * и подставленное значение упёрлось бы в отказ «такой стандарт уже есть». Вид и
 * правила записи наследуются: новая редакция документа — тот же документ.
 */
export function newEditionValues(previous: FoodStandard): StandardFormValues {
  return {
    ...toStandardValues(previous),
    name: "",
    version: "",
    effectiveOn: "",
  };
}

export function toStandardValues(standard: FoodStandard): StandardFormValues {
  return {
    name: standard.name,
    publisher: standard.publisher ?? "",
    document: standard.document ?? "",
    version: standard.version ?? "",
    effectiveOn: standard.effective_on ?? "",
    kind: standard.kind,
    dietType: standard.diet_type,
    // Заведённых с `net` не бывает: сервер их отклоняет.
    carbsConvention:
      standard.carbs_convention === "unknown" ? "unknown" : "total",
  };
}

function description(values: StandardFormValues) {
  return {
    name: values.name.trim(),
    publisher: values.publisher.trim() || null,
    document: values.document.trim() || null,
    version: values.version.trim() || null,
    effective_on: values.effectiveOn || null,
  };
}

export function toStandardCreateBody(
  values: StandardFormValues,
): FoodStandardCreateBody {
  return {
    ...description(values),
    kind: values.kind,
    diet_type: values.dietType,
    carbs_convention: values.carbsConvention,
  };
}

export function toStandardUpdateBody(
  values: StandardFormValues,
  isActive: boolean,
): FoodStandardUpdateBody {
  return { ...description(values), is_active: isActive };
}
