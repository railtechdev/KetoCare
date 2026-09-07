import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type RecipeImportReport = components["schemas"]["RecipeImportReport"];
export type RecipeImportRow = components["schemas"]["RecipeImportRow"];
export type RecipeImportError = components["schemas"]["ImportRowError"];

/**
 * CSV-импорт рецептов (раздел 15 п. 24 ТЗ).
 *
 * `dryRun` обязателен в вызове, а не по умолчанию: пропущенный флаг означал бы
 * запись — а этот запрос заводит рецепты, по которым потом кормят ребёнка.
 */
export function useImportRecipesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      file: File;
      dryRun: boolean;
    }): Promise<RecipeImportReport> => {
      const { data, error } = await api.POST("/api/v1/recipes/import", {
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
      // Список рецептов перечитывается только после настоящей записи: превью
      // ничего не меняет, и лишний запрос после него — это мигание выдачи.
      if (!report.dry_run && report.imported > 0) {
        void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      }
    },
  });
}
