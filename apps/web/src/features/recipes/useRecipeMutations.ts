import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import type { RecipeWriteBody } from "./types";

/**
 * Мутации базы рецептов (раздел 5.3 ТЗ: admin/dietitian).
 *
 * Каждая инвалидирует ключ `['recipes']` целиком — и список, и карточку:
 * показатели рецепта пересчитывает сервер, поэтому сохранённое локально тело
 * запроса не годится в качестве нового состояния.
 */
function useRecipesInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["recipes"] });
  };
}

export function useCreateRecipeMutation() {
  const invalidate = useRecipesInvalidation();

  return useMutation({
    mutationFn: async (body: RecipeWriteBody) => {
      const { data, error } = await api.POST("/api/v1/recipes", { body });
      if (error || !data) throw error ?? new Error("Empty create response");
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateRecipeMutation(recipeId: string | null) {
  const invalidate = useRecipesInvalidation();

  return useMutation({
    mutationFn: async (body: RecipeWriteBody) => {
      if (recipeId === null) throw new Error("recipeId is required to update");

      const { data, error } = await api.PUT("/api/v1/recipes/{recipe_id}", {
        params: { path: { recipe_id: recipeId } },
        body,
      });
      if (error || !data) throw error ?? new Error("Empty update response");
      return data;
    },
    onSuccess: invalidate,
  });
}

export function usePublishRecipeMutation() {
  const invalidate = useRecipesInvalidation();

  return useMutation({
    mutationFn: async (recipeId: string) => {
      const { data, error } = await api.POST(
        "/api/v1/recipes/{recipe_id}/publish",
        { params: { path: { recipe_id: recipeId } } },
      );
      if (error || !data) throw error ?? new Error("Empty publish response");
      return data;
    },
    onSuccess: invalidate,
  });
}

/**
 * Снятие рецепта с публикации.
 *
 * До этого публикация была необратимой — при том что отказ удалить
 * использованный рецепт сам советовал «снимите его с публикации».
 */
export function useUnpublishRecipeMutation() {
  const invalidate = useRecipesInvalidation();

  return useMutation({
    mutationFn: async (recipeId: string) => {
      const { data, error } = await api.POST(
        "/api/v1/recipes/{recipe_id}/unpublish",
        { params: { path: { recipe_id: recipeId } } },
      );
      if (error || !data) throw error ?? new Error("Empty unpublish response");
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteRecipeMutation() {
  const invalidate = useRecipesInvalidation();

  return useMutation({
    mutationFn: async (recipeId: string) => {
      // 204 без тела: успех подтверждается отсутствием error, а не данными.
      const { error } = await api.DELETE("/api/v1/recipes/{recipe_id}", {
        params: { path: { recipe_id: recipeId } },
      });
      if (error) throw error;
      return recipeId;
    },
    onSuccess: invalidate,
  });
}

/**
 * Загрузка фото рецепта.
 *
 * Отдельным действием, а не полем формы: владелец вложения обязателен, а
 * рецепт до сохранения идентификатора не имеет (ADR-0013, решение 8).
 *
 * `body` — `FormData`: сгенерированный клиент типизирует тело по OpenAPI, но
 * multipart он не сериализует, и объект здесь передаётся как есть.
 */
export function useUploadRecipePhotoMutation() {
  const invalidate = useRecipesInvalidation();

  return useMutation({
    mutationFn: async ({
      recipeId,
      file,
    }: {
      recipeId: string;
      file: File;
    }) => {
      const form = new FormData();
      form.append("file", file);

      const { data, error } = await api.PUT(
        "/api/v1/recipes/{recipe_id}/photo",
        {
          params: { path: { recipe_id: recipeId } },
          body: form as unknown as { file: string },
          // Заголовок ставит браузер: он обязан нести boundary, а заданный руками
          // Content-Type его теряет, и сервер не разберёт тело.
          bodySerializer: (body: unknown) => body as FormData,
        },
      );
      if (error || !data) throw error ?? new Error("Empty photo response");
      return data;
    },
    onSuccess: invalidate,
  });
}
