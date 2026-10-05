import { useQuery } from "@tanstack/react-query";
import type { TrendPoint, PrescriptionMarker } from "@ketocare/ui";

import { api } from "../../lib/api";

/** Глубина графика. Тридцать дней — это то, о чём врач спрашивает на приёме. */
export const TREND_DAYS = 30;

export type TrendKind = "ketones" | "weight" | "seizures";

/**
 * Приступы по дням: сумма `count` за местные сутки, нули включены.
 *
 * Нули — это и есть сведения: день без приступа на графике обязан стоять
 * точкой на нуле, а не пропуском, иначе линия соединяла бы два тяжёлых дня
 * через спокойную неделю. Пустой ответ — ни одного приступа за месяц —
 * возвращает пустой ряд, и график говорит «записей нет» словами.
 */
export function seizuresPerDay(
  items: readonly { occurred_at: string; count: number }[],
  now: Date = new Date(),
): TrendPoint[] {
  if (items.length === 0) return [];
  const days: TrendPoint[] = [];
  const index = new Map<string, TrendPoint>();
  const first = startOfDay(now);
  first.setDate(first.getDate() - (TREND_DAYS - 1));
  for (let offset = 0; offset < TREND_DAYS; offset += 1) {
    const day = new Date(first);
    day.setDate(first.getDate() + offset);
    const point = { at: day, value: 0 };
    days.push(point);
    index.set(day.toDateString(), point);
  }
  for (const item of items) {
    const point = index.get(new Date(item.occurred_at).toDateString());
    if (point !== undefined) point.value += item.count;
  }
  return days;
}

/**
 * Границы периода — моменты с поясом, а не даты.
 *
 * Ручка дневника принимает `datetime` и отклоняет голую дату («Input should
 * have timezone info»); я выяснил это, открыв экран, а не прочитав схему. Плюс
 * границы берутся по местным суткам: замер в 23:40 относится к своему дню, а не
 * к следующему по UTC.
 */
export function trendRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const from = startOfDay(now);
  from.setDate(from.getDate() - (TREND_DAYS - 1));
  return { from: from.toISOString(), to: endOfDay(now).toISOString() };
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function endOfDay(value: Date): Date {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
    23,
    59,
    59,
    999,
  );
}

export function useTrend(patientId: string, kind: TrendKind) {
  const range = trendRange();

  return useQuery({
    queryKey: ["patient", patientId, "trend", kind, range.from, range.to],
    queryFn: async (): Promise<TrendPoint[]> => {
      const params = {
        path: { patient_id: patientId },
        query: { from: range.from, to: range.to, limit: 200, offset: 0 },
      };

      if (kind === "seizures") {
        const { data, error } = await api.GET(
          "/api/v1/patients/{patient_id}/logs/seizures",
          { params },
        );
        if (error || !data) throw error ?? new Error("Empty seizures response");
        return seizuresPerDay(data.items);
      }

      if (kind === "ketones") {
        const { data, error } = await api.GET(
          "/api/v1/patients/{patient_id}/logs/ketones",
          { params },
        );
        if (error || !data) throw error ?? new Error("Empty ketones response");
        return data.items.map((item) => ({
          at: new Date(item.occurred_at),
          value: item.value,
        }));
      }

      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/logs/weight",
        {
          params,
        },
      );
      if (error || !data) throw error ?? new Error("Empty weight response");
      return data.items.map((item) => ({
        at: new Date(item.occurred_at),
        // weight:raw — точка графика: подпись оси форматирует сама ось.
        value: item.weight_kg,
      }));
    },
  });
}

/**
 * Вертикальные черты смены назначения.
 *
 * Без них график вводит в заблуждение: скачок кетонов после смены соотношения
 * читается как ухудшение состояния, хотя это следствие изменённой терапии.
 * Поэтому отказ этого запроса приложение обязано показать, а не проглотить, —
 * график без черт молча говорит неправду.
 */
export function usePrescriptionMarkers(patientId: string) {
  return useQuery({
    queryKey: ["patient", patientId, "prescriptions", "markers"],
    queryFn: async (): Promise<PrescriptionMarker[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/prescriptions",
        {
          params: {
            path: { patient_id: patientId },
            query: { limit: 50, offset: 0 },
          },
        },
      );
      if (error || !data)
        throw error ?? new Error("Empty prescriptions response");
      return data.items.map((item) => ({
        at: new Date(item.effective_from),
        label: `${item.ratio}:1`,
      }));
    },
  });
}
