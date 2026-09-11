import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";
import { exceedsCalcGrams } from "@ketocare/ui";

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

/** Строка состава: продукт и его масса — сырым вводом.

Строка, а не число: поле контролируемое, и числовое состояние глотало бы
запятую в момент набора («12,» превращалось в «12», и запятая исчезала
из-под пальца). Разбор — в `parseAmount`, одном для граммовки и калорий. */
export interface DishRow {
  product: ProductOption;
  grams: string;
}

/**
 * Число из поля — с запятой тоже.
 *
 * Русская клавиатура телефона в числовом режиме даёт запятую, а `Number`
 * понимает только точку: «12,5» превращалось в не-число, расчёт молча не
 * запускался, и экран не объяснял почему. Бот запятую принимает с самого
 * начала — здесь то же правило (находка М5 аудита).
 */
export function parseAmount(raw: string): number {
  const value = Number(raw.trim().replace(",", "."));
  return Number.isFinite(value) ? value : 0;
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
  // Массу тяжелее предела сервер не примет: вместо показателей пришёл бы
  // общий отказ, а причину экран уже называет у поля.
  const ready =
    rows.length > 0 &&
    rows.every((row) => {
      const grams = parseAmount(row.grams);
      return grams > 0 && !exceedsCalcGrams(grams);
    });

  return useQuery({
    queryKey: [
      "calc",
      "verify",
      patientId,
      rows.map((r) => `${r.product.id}:${parseAmount(r.grams)}`),
      targets,
    ],
    enabled: ready,
    // Проверка зависит только от ввода: возврат в Telegram ничего в ней не
    // меняет. Перезапрос по фокусу снимал баннер отказа на время запроса —
    // у запроса с ошибкой нет данных, и он всегда считается устаревшим.
    refetchOnWindowFocus: false,
    // `signal`: при смене ввода прежний запрос отменяется, а не дорабатывает
    // впустую, держа экран в состоянии «идёт проверка».
    queryFn: async ({ signal }): Promise<Verify> => {
      const { data, error } = await api.POST("/api/v1/calc/verify", {
        signal,
        body: {
          patient_id: patientId,
          ingredients: rows.map(ingredientOf),
          items: rows.map((row) => ({
            product_id: row.product.id,
            grams: parseAmount(row.grams),
          })),
          targets: targets === null ? null : targetsBody(targets),
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

/**
 * Тело целей — одно на проверку и на подбор.
 *
 * Переключателя «чистых углеводов» здесь больше нет: клиника ответила (вопросы
 * 2 и 6), что соотношение считается по чистым углеводам всегда, а лимит — по
 * общим (вопрос 3). Это правило сервера, а не выбор клиента.
 */
function targetsBody(targets: Targets) {
  return {
    ratio: targets.ratio,
    kcal: targets.kcal,
    protein_min_g: targets.protein_min_g ?? null,
    carbs_max_g: targets.carbs_max_g ?? null,
  };
}

export type Solve = components["schemas"]["SolveResponse"];
export type Scale = components["schemas"]["ScaleResponse"];

/**
 * Подбор раскладки под цели (раздел 6.2 ТЗ).
 *
 * Мутация, а не запрос: подбор ПЕРЕЗАПИСЫВАЕТ граммовку в полях, и запуск по
 * ходу набора вырывал бы поля из-под пальцев. Запускает человек кнопкой — так
 * же, как в кабинете.
 *
 * Массы задаёт решатель на сервере; клиент не считает ничего и здесь. Состав
 * (какие продукты) остаётся за человеком, `patient_id` — чтобы сервер снял со
 * входа исключённые ребёнку продукты (раздел 6.3 ТЗ): в подборе это не
 * предупреждение, а вычёркивание, иначе решателю позволено предложить ребёнку
 * то, что ему нельзя.
 */
export function useSolve(patientId: string) {
  return useMutation({
    // Расчёт, а не запись: ничего не сохраняет и без сети ждёт связи со
    // строкой ожидания на экране. Закреплено против общего «отказ сразу» для
    // записей (ADR-0034).
    networkMode: "online",
    mutationFn: async (input: {
      rows: DishRow[];
      targets: Targets;
    }): Promise<Solve> => {
      const { data, error } = await api.POST("/api/v1/calc/solve", {
        body: {
          patient_id: patientId,
          ingredients: input.rows.map(ingredientOf),
          targets: targetsBody(input.targets),
        },
      });
      if (error || !data) throw error ?? new Error("Empty solve response");
      return data;
    },
  });
}

/**
 * Пересчёт блюда на другую порцию (раздел 6.4 ТЗ).
 *
 * Множитель применяет ядро, а не браузер: умножение «в уме» на клиенте — это
 * второй источник клинического числа (правило 2 CLAUDE.md). Пациент серверу не
 * нужен: состав не меняется, выбирать не из чего, исключать нечего.
 */
export function useScale() {
  return useMutation({
    // Расчёт, а не запись: ничего не сохраняет и без сети ждёт связи со
    // строкой ожидания на экране. Закреплено против общего «отказ сразу» для
    // записей (ADR-0034).
    networkMode: "online",
    mutationFn: async (input: {
      rows: DishRow[];
      factor: number;
    }): Promise<Scale> => {
      const { data, error } = await api.POST("/api/v1/calc/scale", {
        body: {
          ingredients: input.rows.map(ingredientOf),
          items: input.rows.map((row) => ({
            product_id: row.product.id,
            grams: parseAmount(row.grams),
          })),
          factor: input.factor,
        },
      });
      if (error || !data) throw error ?? new Error("Empty scale response");
      return data;
    },
  });
}

/** Продукт на 100 г — как его ждёт `/calc`. */
function ingredientOf(row: DishRow) {
  return {
    product_id: row.product.id,
    kcal: row.product.kcal,
    fat: row.product.fat,
    protein: row.product.protein,
    carbs: row.product.carbs,
    fiber: row.product.fiber,
  };
}
