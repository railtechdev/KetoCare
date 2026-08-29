import type { DefaultValues } from "react-hook-form";
import { z } from "zod";

import { parseDateInput, toDateInput } from "../diary/time";
import type {
  Prescription,
  PrescriptionBody,
  PrescriptionVersion,
} from "./types";

/**
 * Границы полей назначения из раздела 8.3 ТЗ («ratio 1.0-5.0 шаг 0.5,
 * kcal 500-3000»). Ровно эти же значения проверяет сервер (`PrescriptionCreate`
 * в `apps/api`), поэтому форма не смягчает и не ужесточает их.
 *
 * Это границы ввода, а не медицинские допуски: допуски соответствия назначению
 * живут в ядре и на клиент не копируются (правило 2 CLAUDE.md).
 */
export const RATIO_MIN = 1;
export const RATIO_MAX = 5;
export const RATIO_STEP = 0.5;
export const KCAL_MIN = 500;
export const KCAL_MAX = 3000;

/** Кратность шагу 0.5 с поправкой на двоичное представление дробей. */
export function isRatioOnStep(value: number): boolean {
  const steps = value / RATIO_STEP;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

export const prescriptionFormSchema = z.object({
  ratio: z.number().min(RATIO_MIN).max(RATIO_MAX).refine(isRatioOnStep),
  kcalPerDay: z.number().int().min(KCAL_MIN).max(KCAL_MAX),
  // Верхние границы белка, углеводов и числа приёмов остаются за сервером:
  // клиентская копия предельных значений со временем разошлась бы со схемой API.
  // Здесь проверяется только то, без чего назначение бессмысленно.
  proteinG: z.number().positive(),
  carbsLimitG: z.number().min(0),
  mealsPerDay: z.number().int().positive(),
  effectiveFrom: z.string().refine((value) => parseDateInput(value) !== null),
  restrictions: z.string(),
});

export type PrescriptionFormValues = z.infer<typeof prescriptionFormSchema>;

/**
 * Значения формы для новой версии назначения.
 *
 * Поля предзаполняются действующим назначением: новая версия почти всегда —
 * правка одного показателя, и заставлять врача перенабирать остальные пять
 * значит провоцировать опечатку в них. Дата вступления в силу — сегодня:
 * назначение задним числом расходится с уже прожитыми днями меню.
 */
export function prescriptionFormValues(
  active: Prescription | null,
  today: Date,
): DefaultValues<PrescriptionFormValues> {
  if (active === null) {
    return { effectiveFrom: toDateInput(today), restrictions: "" };
  }

  return {
    ratio: active.ratio,
    kcalPerDay: active.kcal_per_day,
    proteinG: active.protein_g,
    carbsLimitG: active.carbs_limit_g,
    mealsPerDay: active.meals_per_day,
    effectiveFrom: toDateInput(today),
    restrictions: active.restrictions ?? "",
  };
}

/**
 * Значения формы — в тело `POST /patients/{id}/prescriptions`.
 *
 * Выполнимость сочетания (цель по белку против kcal/(9R+4)) проверяет сервер:
 * это тождество расчётного ядра, и его копия здесь разошлась бы с ядром при
 * первом же изменении формулы.
 */
export function toPrescriptionBody(
  values: PrescriptionFormValues,
): PrescriptionBody {
  const restrictions = values.restrictions.trim();

  return {
    ratio: values.ratio,
    kcal_per_day: values.kcalPerDay,
    protein_g: values.proteinG,
    carbs_limit_g: values.carbsLimitG,
    meals_per_day: values.mealsPerDay,
    effective_from: values.effectiveFrom,
    restrictions: restrictions === "" ? null : restrictions,
  };
}

/**
 * История назначений с номерами версий.
 *
 * Сервер номеров не хранит: `prescriptions` append-only, версия — порядковый
 * номер строки по времени создания (раздел 4.2 ТЗ). История приходит от новых к
 * старым (`list_history` сортирует по убыванию `created_at`), поэтому номер —
 * это `total - index`, и он не зависит от того, сколько версий поместилось на
 * страницу.
 */
export function withVersions(
  items: Prescription[],
  total: number,
): PrescriptionVersion[] {
  return items.map((prescription, index) => ({
    version: total - index,
    prescription,
  }));
}
