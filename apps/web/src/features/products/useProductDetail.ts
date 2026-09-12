import { useQuery } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type ProductDetail = components["schemas"]["ProductRead"];

/**
 * Ключ карточки продукта — общий у справочника, карточки рецепта и формы.
 *
 * Общий ключ обязывает к общему значению: пока у каждого потребителя был свой
 * `queryFn`, один и тот же кэш означал для них разное, и положенный туда
 * `null` (ответ «такого продукта нет») читался соседом как «данных нет вовсе»
 * — карточка продукта рисовалась пустой, без ошибки и без «не найден».
 */
export function productDetailKey(productId: string) {
  return ["products", "detail", productId] as const;
}

/**
 * Запрос карточки. `null` — справочник ответил «такого продукта нет» (404).
 *
 * 404 здесь ОТВЕТ, а не сбой связи: смешать их значит либо обещать имя,
 * которое никогда не придёт, либо назвать удалённым то, что просто не доехало.
 */
export async function fetchProductDetail(
  productId: string,
): Promise<ProductDetail | null> {
  const { data, error, response } = await api.GET(
    "/api/v1/products/{product_id}",
    { params: { path: { product_id: productId } } },
  );
  if (response.status === 404) return null;
  if (error || !data) throw error ?? new Error("Empty product response");
  return data;
}

/**
 * Продукт целиком по идентификатору.
 *
 * Нужен там, где позиция открыта ссылкой, а не выбором из показанного списка:
 * до этого редактор искал её среди загруженной страницы и на «не нашёл»
 * открывал форму заведения новой — то есть по ссылке на существующий продукт
 * администратор видел пустую форму «Новый продукт» и мог завести дубль.
 *
 * `retry: false` — несуществующий идентификатор из чужой или устаревшей ссылки
 * повтором не оживёт.
 */
export function useProductDetail(productId: string | null) {
  return useQuery({
    queryKey: productDetailKey(productId as string),
    enabled: productId !== null,
    retry: false,
    queryFn: () => fetchProductDetail(productId as string),
  });
}
