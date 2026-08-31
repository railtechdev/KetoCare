import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import type { ProductCategory } from "../admin/types";

export interface CategoryValues {
  name_ru: string;
  sort: number;
}

/**
 * Правки справочника категорий.
 *
 * Все три мутации сбрасывают ключ `['products']` целиком: категория участвует
 * и в списке справочника, и в фильтре, и в форме продукта — обновлять их по
 * отдельности значит однажды забыть одно из мест.
 */
function useCategoriesInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["products"] });
}

export function useCreateCategoryMutation() {
  const invalidate = useCategoriesInvalidation();

  return useMutation({
    mutationFn: async (values: CategoryValues): Promise<ProductCategory> => {
      const { data, error } = await api.POST("/api/v1/products/categories", {
        body: values,
      });
      if (error || !data) throw error ?? new Error("Empty category response");
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateCategoryMutation(categoryId: string) {
  const invalidate = useCategoriesInvalidation();

  return useMutation({
    mutationFn: async (values: CategoryValues): Promise<ProductCategory> => {
      const { data, error } = await api.PUT(
        "/api/v1/products/categories/{category_id}",
        {
          params: { path: { category_id: categoryId } },
          body: values,
        },
      );
      if (error || !data) throw error ?? new Error("Empty category response");
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useMergeCategoryMutation(categoryId: string) {
  const invalidate = useCategoriesInvalidation();

  return useMutation({
    mutationFn: async (intoId: string): Promise<number> => {
      const { data, error } = await api.POST(
        "/api/v1/products/categories/{category_id}/merge",
        {
          params: { path: { category_id: categoryId } },
          body: { into_id: intoId },
        },
      );
      if (error || !data) throw error ?? new Error("Empty merge response");
      return data.moved;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteCategoryMutation() {
  const invalidate = useCategoriesInvalidation();

  return useMutation({
    mutationFn: async (categoryId: string) => {
      const { error } = await api.DELETE(
        "/api/v1/products/categories/{category_id}",
        { params: { path: { category_id: categoryId } } },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
