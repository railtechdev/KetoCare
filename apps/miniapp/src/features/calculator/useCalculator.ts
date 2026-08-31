import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type Verify = components["schemas"]["VerifyResponse"];

export interface ProductOption {
  id: string;
  name: string;
  kcal: number;
  fat: number;
  protein: number;
  carbs: number;
  fiber: number;
}

/** Строка состава: продукт и его масса. */
export interface DishRow {
  product: ProductOption;
  grams: number;
}

/** Ниже двух символов выдача бесполезна, а индекс нагружается зря. */
export const MIN_QUERY = 2;

export function useProductSearch(query: string) {
  const trimmed = query.trim();

  return useQuery({
    queryKey: ["products", "search", trimmed],
    enabled: trimmed.length >= MIN_QUERY,
    // Прошлая выдача держится на экране, пока грузится новая: иначе список
    // мигает пустотой на каждой набранной букве.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ProductOption[]> => {
      const { data, error } = await api.GET("/api/v1/products", {
        params: { query: { q: trimmed, limit: 20, offset: 0 } },
      });
      if (error || !data) throw error ?? new Error("Empty products response");

      return data.items.map((item) => ({
        id: item.id,
        name: item.name_ru,
        kcal: item.kcal_100g,
        fat: item.fat_100g,
        protein: item.protein_100g,
        carbs: item.carbs_100g,
        fiber: item.fiber_100g,
      }));
    },
  });
}

/**
 * Проверка состава (раздел 6 ТЗ).
 *
 * Считает сервер и только сервер: своя формула на клиенте — это второй источник
 * клинического числа, который разойдётся с ядром при первом же его изменении
 * (правило 2 CLAUDE.md). Отсюда же `engine_version` в ответе.
 *
 * `patient_id` передаётся всегда: без него `/calc` не знает ребёнка, и
 * исключённые ему продукты некому заметить (раздел 6.3 ТЗ).
 */
export function useVerify(
  patientId: string,
  rows: DishRow[],
  targets: Targets | null,
) {
  const ready = rows.length > 0 && rows.every((row) => row.grams > 0);

  return useQuery({
    queryKey: [
      "calc",
      "verify",
      patientId,
      rows.map((r) => `${r.product.id}:${r.grams}`),
      targets,
    ],
    enabled: ready,
    queryFn: async (): Promise<Verify> => {
      const { data, error } = await api.POST("/api/v1/calc/verify", {
        body: {
          patient_id: patientId,
          ingredients: rows.map((row) => ({
            product_id: row.product.id,
            kcal: row.product.kcal,
            fat: row.product.fat,
            protein: row.product.protein,
            carbs: row.product.carbs,
            fiber: row.product.fiber,
          })),
          items: rows.map((row) => ({
            product_id: row.product.id,
            grams: row.grams,
          })),
          // `net_carbs: false` — то же значение, что по умолчанию у сервера.
          // Схема требует его явно, а выбирать режим «чистых углеводов» на
          // клиенте нельзя: считать ли клетчатку в углеводах — вопрос 6
          // медицинской команде, и до ответа режим не включается нигде.
          targets: targets === null ? null : { ...targets, net_carbs: false },
        },
      });
      if (error || !data) throw error ?? new Error("Empty verify response");
      return data;
    },
  });
}

export interface Targets {
  ratio: number;
  kcal: number;
  protein_min_g?: number | null;
  carbs_max_g?: number | null;
}
