import { useMutation } from "@tanstack/react-query";

import { api } from "../../lib/api";
import type { ArticleText } from "./types";

/**
 * A Word file turned into the article's text (ADR-0093). Nothing is saved:
 * the text comes back into the form, and the author sees and corrects it
 * before saving — a converter that wrote straight into the article would
 * publish what nobody has read.
 */
export function useArticleTextMutation() {
  return useMutation({
    mutationFn: async (file: File): Promise<ArticleText> => {
      const { data, error } = await api.POST(
        "/api/v1/knowledge-base/article-text",
        {
          // The file field is a binary string in OpenAPI; the multipart body
          // is built by the serializer, as for the recipe import.
          body: { file: file as unknown as string },
          bodySerializer: () => {
            const form = new FormData();
            form.append("file", file);
            return form;
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty conversion response");
      return data;
    },
  });
}
