import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type ImportDraft = components["schemas"]["RecipeImportView"];
export type ImportDraftSummary = components["schemas"]["RecipeImportSummary"];
export type ImportName = components["schemas"]["ImportName"];
export type ImportRecipe = components["schemas"]["ImportRecipe"];
export type ImportLine = components["schemas"]["ImportLine"];
export type ImportRecipeEdit = components["schemas"]["RecipeEdit"];

/** Как часто спрашивать сервер, пока файл читается. */
const POLL_MS = 3000;

const draftKey = (draftId: string) => ["recipe-imports", draftId] as const;

/**
 * Файл с рецептами на проверке (ADR-0079).
 *
 * Черновик живёт на сервере: большой сборник разбирают в несколько подходов,
 * и состояние, существующее только в памяти вкладки, пропало бы при первой же
 * перезагрузке. Поэтому каждое решение проверяющего — запрос, а ответ на него —
 * черновик целиком: что стало готово после одного решения по названию,
 * решает сервер, и считать это второй раз в браузере нельзя.
 */
export function useImportDraft(draftId: string) {
  return useQuery({
    queryKey: draftKey(draftId),
    queryFn: async (): Promise<ImportDraft> => {
      const { data, error } = await api.GET(
        "/api/v1/recipe-imports/{draft_id}",
        { params: { path: { draft_id: draftId } } },
      );
      if (error || !data) throw error ?? new Error("Empty import draft");
      return data;
    },
    // Пока файл читается, рецепты появляются по частям. Застрявшее чтение
    // опрашивать незачем: продолжить его может только человек.
    refetchInterval: (query) =>
      query.state.data?.status === "parsing" && !query.state.data.stalled
        ? POLL_MS
        : false,
  });
}

/** Незаконченные загрузки проверяющего — чтобы вернуться к начатому. */
export function useImportDrafts() {
  return useQuery({
    queryKey: ["recipe-imports"],
    queryFn: async (): Promise<ImportDraftSummary[]> => {
      const { data, error } = await api.GET("/api/v1/recipe-imports");
      if (error || !data) throw error ?? new Error("Empty import drafts");
      return data;
    },
  });
}

export function useStartImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: { file: File } | { text: string },
    ): Promise<ImportDraftSummary> => {
      const { data, error } = await api.POST("/api/v1/recipe-imports", {
        // В OpenAPI поле файла описано строкой (binary): по сети уходит
        // multipart/form-data, который собирает bodySerializer.
        body: {} as never,
        bodySerializer: () => {
          const form = new FormData();
          if ("file" in input) form.append("file", input.file);
          else form.append("text", input.text);
          return form;
        },
      });
      if (error || !data) throw error ?? new Error("Empty import response");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recipe-imports"] });
    },
  });
}

/** Ответ правки — черновик целиком: он и становится новым состоянием экрана. */
function useDraftMutation<Input>(
  draftId: string,
  request: (input: Input) => Promise<ImportDraft>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: request,
    onSuccess: (draft) => {
      queryClient.setQueryData(draftKey(draftId), draft);
    },
  });
}

export function useDecideName(draftId: string) {
  return useDraftMutation(
    draftId,
    async (input: {
      key: string;
      productId?: string;
      leftOut?: boolean;
    }): Promise<ImportDraft> => {
      const { data, error } = await api.PUT(
        "/api/v1/recipe-imports/{draft_id}/names",
        {
          params: { path: { draft_id: draftId } },
          body: {
            key: input.key,
            product_id: input.productId ?? null,
            left_out: input.leftOut ?? false,
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty import draft");
      return data;
    },
  );
}

export function useEditImportRecipe(draftId: string) {
  return useDraftMutation(
    draftId,
    async (input: {
      recipeId: string;
      edit: ImportRecipeEdit;
    }): Promise<ImportDraft> => {
      const { data, error } = await api.PATCH(
        "/api/v1/recipe-imports/{draft_id}/recipes/{recipe_id}",
        {
          params: {
            path: { draft_id: draftId, recipe_id: input.recipeId },
          },
          body: input.edit,
        },
      );
      if (error || !data) throw error ?? new Error("Empty import draft");
      return data;
    },
  );
}

export function useResumeImport(draftId: string) {
  return useDraftMutation(draftId, async (): Promise<ImportDraft> => {
    const { data, error } = await api.POST(
      "/api/v1/recipe-imports/{draft_id}/resume",
      { params: { path: { draft_id: draftId } } },
    );
    if (error || !data) throw error ?? new Error("Empty import draft");
    return data;
  });
}

export function useCommitImport(draftId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    /**
     * Принимаются строки, которые были на экране, — с подписью того, как они
     * на нём читались. «Всё готовое на сервере» включало бы рецепт, дописанный
     * чтением секунду назад, которого человек не видел.
     */
    mutationFn: async (
      shown: readonly ImportRecipe[],
    ): Promise<{ imported: number; draft: ImportDraft }> => {
      const { data, error } = await api.POST(
        "/api/v1/recipe-imports/{draft_id}/commit",
        {
          params: { path: { draft_id: draftId } },
          body: {
            recipes: shown
              .filter((recipe) => recipe.state === "ready")
              .map((recipe) => ({
                id: recipe.id,
                signature: recipe.signature,
              })),
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty commit response");
      return data;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(draftKey(draftId), result.draft);
      if (result.imported > 0) {
        void queryClient.invalidateQueries({ queryKey: ["recipes"] });
        void queryClient.invalidateQueries({
          queryKey: ["recipe-imports"],
          exact: true,
        });
      }
    },
  });
}

export function useCloseImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (draftId: string): Promise<void> => {
      const { error } = await api.DELETE("/api/v1/recipe-imports/{draft_id}", {
        params: { path: { draft_id: draftId } },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["recipe-imports"],
        exact: true,
      });
    },
  });
}
