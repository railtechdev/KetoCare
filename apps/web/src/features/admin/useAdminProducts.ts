import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api } from "../../lib/api";
import {
  MAX_PAGE_SIZE,
  type ProductCreateBody,
  type ProductUpdateBody,
} from "./types";

export interface ProductFilters {
  q: string;
  /** Пустая строка — фильтр по категории не задан */
  categoryId: string;
  /**
   * Показывать выведенные из оборота позиции.
   *
   * По умолчанию их не видно — в этом и смысл вывода. Но тот, кто вывел, обязан
   * иметь возможность вернуть: без этого флажка снятие «активен» было
   * необратимым, позиция исчезала из выдачи насовсем.
   *
   * Сервер отдаёт их только ролям, которые ведут справочник, — здесь это UX.
   */
  includeInactive: boolean;
}

export const EMPTY_PRODUCT_FILTERS: ProductFilters = {
  q: "",
  categoryId: "",
  includeInactive: false,
};

/**
 * Справочник продуктов для администратора (раздел 8.3 ТЗ, «Админ / Продукты»).
 *
 * Ручка та же, что у родительского справочника, поэтому ключ начинается с
 * `['products']`: правка продукта инвалидирует оба экрана разом.
 */
/**
 * Справочник категорий продуктов.
 *
 * Меняется правкой справочника, а не ходом работы, поэтому кэшируется надолго.
 * Пока ручки не было, категория задавалась идентификатором: в таблице стоял
 * обрезанный UUID, а завести продукт в новую категорию было нельзя вовсе.
 */
export function useProductCategories() {
  return useQuery({
    queryKey: ["products", "categories"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/products/categories", {});
      if (error || !data) throw error ?? new Error("Empty categories response");
      return data;
    },
  });
}

export function useAdminProducts(filters: ProductFilters) {
  const query = {
    q: filters.q.trim() || undefined,
    category_id: filters.categoryId.trim() || undefined,
    include_inactive: filters.includeInactive || undefined,
    limit: MAX_PAGE_SIZE,
    offset: 0,
  };

  return useQuery({
    queryKey: ["products", "list", query],
    // Прошлая выдача держится на экране, пока грузится новая: иначе таблица
    // мигает пустотой на каждой набранной букве.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/products", {
        params: { query },
      });
      if (error || !data) throw error ?? new Error("Empty products response");
      return data;
    },
  });
}

/**
 * Правка продукта видна и в справочнике, и в журнале аудита: `POST/PUT
 * /products` пишут `audit_log` (правило 7 CLAUDE.md), а история ревизий позиции
 * строится по нему же.
 */
function useProductsInvalidation() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: ["products"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
  };
}

export function useCreateProductMutation() {
  const invalidate = useProductsInvalidation();

  return useMutation({
    mutationFn: async (body: ProductCreateBody) => {
      const { data, error } = await api.POST("/api/v1/products", { body });
      if (error || !data) throw error ?? new Error("Empty create response");
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateProductMutation(productId: string | null) {
  const invalidate = useProductsInvalidation();

  return useMutation({
    mutationFn: async (body: ProductUpdateBody) => {
      if (productId === null)
        throw new Error("productId is required to update");

      const { data, error } = await api.PUT("/api/v1/products/{product_id}", {
        params: { path: { product_id: productId } },
        body,
      });
      if (error || !data) throw error ?? new Error("Empty update response");
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useImportProductsMutation() {
  const invalidate = useProductsInvalidation();

  return useMutation({
    mutationFn: async (input: { file: File; dryRun: boolean }) => {
      const { data, error } = await api.POST("/api/v1/products/import", {
        params: { query: { dry_run: input.dryRun } },
        // В OpenAPI поле файла описано строкой (binary), поэтому File
        // приводится к типу схемы: по сети уходит multipart/form-data, который
        // собирает bodySerializer — сам File до сериализатора не меняется.
        body: { file: input.file as unknown as string },
        bodySerializer: () => {
          const form = new FormData();
          form.append("file", input.file);
          return form;
        },
      });
      if (error || !data) throw error ?? new Error("Empty import response");
      return data;
    },
    onSuccess: (report) => {
      // Превью ничего не меняет в базе, и неудачный импорт — тоже: перечитывать
      // справочник есть смысл только после реальной записи строк.
      if (!report.dry_run && report.imported > 0) invalidate();
    },
  });
}
