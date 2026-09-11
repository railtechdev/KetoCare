import { useMutation } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { toCalcIngredients, toCalcItems, type DishRow } from "./types";

export interface TargetsInput {
  ratio: number;
  kcal: number;
  proteinMin?: number | null;
  carbsMax?: number | null;
}

function targetsBody(targets: TargetsInput) {
  return {
    ratio: targets.ratio,
    kcal: targets.kcal,
    protein_min_g: targets.proteinMin ?? null,
    // Лимит углеводов — по ОБЩИМ углеводам (ответ клиники, вопрос 3), а
    // соотношение сервер считает по чистым. Переключателя `net_carbs` больше
    // нет: клиника назвала правило, а не выбор.
    carbs_max_g: targets.carbsMax ?? null,
  };
}

export function useVerifyMutation() {
  return useMutation({
    // Экран калькулятора считает, что проверка встаёт на паузу, только если
    // запущена без сети: по этому признаку «Повторить» запоминает текст
    // ожидания. Так и есть лишь при `networkMode: "online"` без `retry` и без
    // `scope` — с ними пауза разойдётся с сетью, а текст на плашке с паузой.
    networkMode: "online",
    // Явно, а не по умолчанию: общий `retry` для мутаций поставил бы на паузу
    // запрос, начатый с сетью.
    retry: false,
    mutationFn: async (input: {
      rows: DishRow[];
      targets?: TargetsInput;
      // Чей расчёт: по нему сервер называет продукты, исключённые ребёнку.
      // Состав при этом не меняется — его задал человек.
      patientId?: string;
    }) => {
      const { data, error } = await api.POST("/api/v1/calc/verify", {
        body: {
          ingredients: toCalcIngredients(input.rows),
          items: toCalcItems(input.rows),
          targets: input.targets ? targetsBody(input.targets) : null,
          patient_id: input.patientId ?? null,
        },
      });
      if (error || !data) throw error ?? new Error("Empty verify response");
      return data;
    },
  });
}

export function useSolveMutation() {
  return useMutation({
    // Расчёт, а не запись: ничего не сохраняет и без сети ждёт связи со
    // строкой ожидания на экране. Закреплено против общего «отказ сразу» для
    // записей (ADR-0034).
    networkMode: "online",
    mutationFn: async (input: {
      rows: DishRow[];
      targets: TargetsInput;
      // Здесь важнее, чем в проверке: подбор сам выбирает, из чего составить
      // блюдо, и исключённые продукты сервер снимает со входа.
      patientId?: string;
    }) => {
      const { data, error } = await api.POST("/api/v1/calc/solve", {
        body: {
          ingredients: toCalcIngredients(input.rows),
          targets: targetsBody(input.targets),
          patient_id: input.patientId ?? null,
        },
      });
      if (error || !data) throw error ?? new Error("Empty solve response");
      return data;
    },
  });
}

export function useScaleMutation() {
  return useMutation({
    // Расчёт, а не запись: ничего не сохраняет и без сети ждёт связи со
    // строкой ожидания на экране. Закреплено против общего «отказ сразу» для
    // записей (ADR-0034).
    networkMode: "online",
    mutationFn: async (input: { rows: DishRow[]; factor: number }) => {
      const { data, error } = await api.POST("/api/v1/calc/scale", {
        body: {
          ingredients: toCalcIngredients(input.rows),
          items: toCalcItems(input.rows),
          factor: input.factor,
        },
      });
      if (error || !data) throw error ?? new Error("Empty scale response");
      return data;
    },
  });
}

/**
 * Сохранение состава в блюда ребёнка.
 *
 * `null` — ребёнок ещё не выбран: так бывает в общем калькуляторе, где состав
 * набирают до того, как решают, кому его передать. Хук объявляется всё равно —
 * условных хуков не бывает, — а запрос без ребёнка не уходит.
 */
export function useSaveDishMutation(patientId: string | null) {
  return useMutation({
    // Запись не ждёт сети в очереди: мутация на паузе создала бы блюдо молча
    // после возврата связи — когда экран, может быть, уже закрыт, без тоста и
    // перехода, — а повторное нажатие дало бы второе такое же блюдо. Без сети
    // запрос уходит сразу и сразу получает отказ, который видит человек.
    networkMode: "always",
    retry: false,
    mutationFn: async (input: { title: string; rows: DishRow[] }) => {
      if (patientId === null) throw new Error("patientId is required to save");

      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/custom-dishes",
        {
          params: { path: { patient_id: patientId } },
          body: {
            title: input.title,
            // Сервер пересчитывает состав сам по product_id: клиентские
            // макронутриенты для сохранения не принимаются.
            ingredients: input.rows.map((row) => ({
              product_id: row.product.id,
              grams: row.grams,
            })),
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty save response");
      return data;
    },
  });
}
