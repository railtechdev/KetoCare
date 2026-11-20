import {
  keepPreviousData,
  useInfiniteQuery,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { productNameState, type ProductName } from "@ketocare/ui";

import { api } from "../../lib/api";

export type Recipe = components["schemas"]["RecipeRead"];
export type ProductDetail = components["schemas"]["ProductRead"];

/**
 * Сколько рецептов приходит за раз. Следующие — по «Показать ещё»: прежде
 * выдача молча обрывалась на двадцатом (аудит 12.11.2026).
 */
export const PAGE_SIZE = 20;

export type RecipeCategory = Recipe["category"];

/**
 * Разделы рецептов — ответ клиники от 09.09.2026 на вопрос 28: «завтрак, обед,
 * ужин, перекус, десерты, напитки, выпечка, хлеб — и в каждый из этих разделов
 * заложить рецепты». `satisfies` связывает список с OpenAPI: новая категория
 * сервера без строки здесь не скомпилируется.
 */
export const RECIPE_CATEGORIES = [
  "breakfast",
  "lunch",
  "dinner",
  "salad",
  "snack",
  "dessert",
  "drink",
  "smoothie",
  "bakery",
  "bread",
] as const satisfies readonly RecipeCategory[];

/**
 * Поиск рецептов страницами.
 *
 * `patientId` — сверить соотношение каждого рецепта с назначением ребёнка:
 * пометку «не как в назначении» решает сервер допуском ядра
 * (`ratio_fits_prescription`), приложение чисел не сравнивает.
 */
export function useRecipeSearch(
  query: string,
  category: RecipeCategory | "",
  patientId?: string,
) {
  const trimmed = query.trim();

  const result = useInfiniteQuery({
    queryKey: ["recipes", "search", patientId ?? null, trimmed, category],
    // Прошлая выдача держится, пока грузится новая: иначе список мигает
    // пустотой на каждой набранной букве.
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.GET("/api/v1/recipes", {
        params: {
          query: {
            q: trimmed === "" ? undefined : trimmed,
            category: category === "" ? undefined : category,
            patient_id: patientId,
            limit: PAGE_SIZE,
            offset: pageParam,
          },
        },
      });
      if (error || !data) throw error ?? new Error("Empty recipes response");
      return { items: data.items, total: data.total, offset: pageParam };
    },
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length;
      return last.items.length > 0 && next < last.total ? next : undefined;
    },
  });

  return {
    ...result,
    recipes: result.data?.pages.flatMap((page) => page.items),
  };
}

/**
 * Один рецепт целиком.
 *
 * Список отдаёт те же поля, но карточка берётся отдельным запросом: рецепт
 * могли поправить с тех пор, как список загрузился, а по нему готовят.
 */
export function useRecipe(recipeId: string | null, patientId?: string) {
  return useQuery({
    queryKey: ["recipes", recipeId, patientId ?? null],
    enabled: recipeId !== null,
    queryFn: async (): Promise<Recipe> => {
      const { data, error } = await api.GET("/api/v1/recipes/{recipe_id}", {
        params: {
          path: { recipe_id: recipeId as string },
          query: { patient_id: patientId },
        },
      });
      if (error || !data) throw error ?? new Error("Empty recipe response");
      return data;
    },
  });
}

/**
 * Названия продуктов состава — по их карточкам.
 *
 * Рецепт хранит только `product_id`: продукт могут переименовать, и снимка имён
 * у рецепта нет. Ключ `['products','detail',id]` тот же, что в кабинете:
 * повторно открытый рецепт берёт названия из кэша, а не из сети.
 */
export function useProductNames(productIds: string[]): {
  stateOf: (productId: string) => ProductName;
  /**
   * Продукты состава, выведенные из оборота: идентификатор → имя.
   *
   * Вывод убирает продукт из поиска, но не из уже сохранённых рецептов — и
   * правильно: рецепт, по которому кормили, задним числом не подменяется. Но
   * молчать об этом нельзя, и по карточке Mini App готовят так же, как по
   * карточке кабинета: выводят продукт обычно потому, что его числа оказались
   * неверными, а по ним посчитаны показатели рецепта.
   *
   * Собирается только из ПРИШЕДШИХ карточек, поэтому удалённый продукт (404,
   * `null`) сюда не попадает и «выведенным» не назовётся.
   */
  withdrawn: Record<string, string>;
} {
  const unique = Array.from(new Set(productIds));

  const results = useQueries({ queries: unique.map(productDetailQuery) });

  // Разбор — общий с кабинетом (`productNameState` в ките): один и тот же
  // рецепт в двух каналах обязан различать эти случаи одинаково.
  const states = new Map<string, ProductName>();
  unique.forEach((id, index) => {
    const result = results[index];
    if (result === undefined) return;
    states.set(
      id,
      productNameState({
        name:
          result.data === undefined
            ? undefined
            : (result.data?.name_ru ?? null),
        isError: result.isError,
        isPaused: result.fetchStatus === "paused",
      }),
    );
  });

  // Карточка продукта приходит целиком ради имени — `is_active` в том же
  // ответе, и второго запроса для пометки не нужно.
  const withdrawn: Record<string, string> = {};
  for (const result of results) {
    const product = result.data;
    if (product && !product.is_active) withdrawn[product.id] = product.name_ru;
  }

  return {
    stateOf: (productId) => states.get(productId) ?? { kind: "pending" },
    withdrawn,
  };
}

/**
 * Карточка продукта справочника — один запрос на имена состава и на загрузку
 * блюда в расчёт: ключ общий, и второй раз продукт из сети не берётся.
 */
export function productDetailQuery(id: string) {
  return {
    queryKey: ["products", "detail", id] as const,
    // Справочник меняется редко: перезапрашивать при каждом открытии
    // карточки незачем.
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ProductDetail | null> => {
      const { data, error, response } = await api.GET(
        "/api/v1/products/{product_id}",
        { params: { path: { product_id: id } } },
      );
      // 404 — это ответ справочника «такого продукта нет», а не сбой связи.
      // Бросить здесь значило бы смешать удаление с недоставленным ответом.
      // Тот же запрос есть в кабинете (`apps/web/src/features/products/
      // useProductDetail.ts`): кэш у приложений разный, но правило одно, и
      // разбор состояний для обоих лежит в ките (`productNameState`).
      if (response.status === 404) return null;
      if (error || !data) throw error ?? new Error("Empty product response");
      return data;
    },
  };
}

/**
 * Фото рецепта картинкой (Б2 аудита Mini App).
 *
 * `<img src>` здесь не годится: кабинет входит кукой, а Mini App держит токен
 * в памяти и шлёт его заголовком (раздел 5.2 ТЗ), и голый адрес картинки
 * получил бы 401. Поэтому фото приходит тем же клиентом API, что и всё
 * остальное, а показывается через адрес объекта — его создаёт и отзывает
 * `RecipePhoto`.
 *
 * Ключ несёт `photo_path`: заменённое фото — другое вложение и другой ключ, и
 * прежняя картинка из кэша не покажется. Нет фото или файл не нашёлся (404) —
 * `null`, и блока на экране нет; любой другой отказ — ошибка, блока тоже нет,
 * но следующее открытие карточки спросит снова.
 */
export function useRecipePhoto(recipeId: string, photoPath: string | null) {
  const has = photoPath !== null && photoPath !== "";
  return useQuery({
    queryKey: ["recipes", recipeId, "photo", photoPath],
    enabled: has,
    staleTime: Infinity,
    // Картинка не клиническое число: без неё карточка полна, и повтор по
    // фокусу только гонял бы файл по сети.
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<Blob | null> => {
      const { data, response } = await api.GET(
        "/api/v1/recipes/{recipe_id}/photo",
        { params: { path: { recipe_id: recipeId } }, parseAs: "blob" },
      );
      // «Фото нет» — только 404. Сбой стенда при выкате (502, 503), 500 или
      // непродлённая сессия — ошибка запроса: закэшированный `null` при
      // бесконечной свежести показывал бы рецепт без фото до перезапуска, а
      // ошибка запрашивается снова при следующем открытии карточки.
      if (response.status === 404) return null;
      if (!response.ok || !(data instanceof Blob)) {
        throw new Error(`Recipe photo: ${response.status}`);
      }
      return data;
    },
  });
}

/** Имя продукта словами: известное, удалённое, не дошедшее или ещё в пути. */
export function productName(
  state: ProductName,
  t: (key: string) => string,
): string {
  switch (state.kind) {
    case "name":
      return state.name;
    case "missing":
      return t("recipes.unknownProduct");
    case "unavailable":
      return t("recipes.nameUnavailable");
    case "pending":
      return t("recipes.loadingName");
  }
}
