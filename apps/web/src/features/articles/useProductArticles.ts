import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { api } from "../../lib/api";
import {
  ARTICLES_PAGE_SIZE,
  type ArticleDetail,
  type ArticleWriteBody,
  type DiscardResult,
} from "./types";

/**
 * Articles about the app (ADR-0093): the administrator only. Built-in ones
 * ship with each release and can only be hidden or shown; his own ones he
 * writes and publishes himself — product articles have no second reader.
 */
export const PRODUCT_ARTICLES_KEY = ["kb-articles", "product"] as const;

export const PRODUCT_TABS = ["builtin", "own"] as const;

export type ProductTab = (typeof PRODUCT_TABS)[number];

export function useProductArticles(tab: ProductTab) {
  return useQuery({
    queryKey: [...PRODUCT_ARTICLES_KEY, "list", tab],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/admin/knowledge-base/product-articles",
        {
          params: {
            query: {
              origin: tab === "builtin" ? "builtin" : "cabinet",
              limit: ARTICLES_PAGE_SIZE,
            },
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty articles response");
      return data;
    },
  });
}

export function useProductArticle(articleId: string | undefined) {
  return useQuery({
    queryKey: [...PRODUCT_ARTICLES_KEY, "detail", articleId],
    enabled: articleId !== undefined,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/admin/knowledge-base/product-articles/{article_id}",
        { params: { path: { article_id: articleId ?? "" } } },
      );
      if (error || !data) throw error ?? new Error("Empty article response");
      return data;
    },
  });
}

function remember(queryClient: QueryClient, article: ArticleDetail) {
  queryClient.setQueryData(
    [...PRODUCT_ARTICLES_KEY, "detail", article.id],
    article,
  );
  void queryClient.invalidateQueries({
    queryKey: [...PRODUCT_ARTICLES_KEY, "list"],
  });
}

function useArticleWrite<TInput>(
  write: (input: TInput) => Promise<ArticleDetail>,
  articleIdOf?: (input: TInput) => string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: (article) => remember(queryClient, article),
    onError: (_error, input) => {
      if (articleIdOf === undefined) return;
      void queryClient.invalidateQueries({
        queryKey: [...PRODUCT_ARTICLES_KEY, "detail", articleIdOf(input)],
      });
    },
  });
}

function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error || !result.data) {
    throw result.error ?? new Error("Empty article response");
  }
  return result.data;
}

const BY_ID = (id: string) => ({ params: { path: { article_id: id } } });

export function useCreateProductArticle() {
  return useArticleWrite(async (body: ArticleWriteBody) =>
    unwrap(
      await api.POST("/api/v1/admin/knowledge-base/product-articles", {
        body,
      }),
    ),
  );
}

export function useUpdateProductArticle() {
  return useArticleWrite(
    async (input: { id: string; body: ArticleWriteBody }) =>
      unwrap(
        await api.PUT(
          "/api/v1/admin/knowledge-base/product-articles/{article_id}",
          { ...BY_ID(input.id), body: input.body },
        ),
      ),
    (input) => input.id,
  );
}

export function usePublishProductArticle() {
  return useArticleWrite(
    async (input: { id: string; contentHash: string }) =>
      unwrap(
        await api.POST(
          "/api/v1/admin/knowledge-base/product-articles/{article_id}/publish",
          { ...BY_ID(input.id), body: { content_hash: input.contentHash } },
        ),
      ),
    (input) => input.id,
  );
}

export function useWithdrawProductArticle() {
  return useArticleWrite(
    async (id: string) =>
      unwrap(
        await api.POST(
          "/api/v1/admin/knowledge-base/product-articles/{article_id}/withdraw",
          BY_ID(id),
        ),
      ),
    (id) => id,
  );
}

export function useNewProductVersion() {
  return useArticleWrite(
    async (id: string) =>
      unwrap(
        await api.POST(
          "/api/v1/admin/knowledge-base/product-articles/{article_id}/new-version",
          BY_ID(id),
        ),
      ),
    (id) => id,
  );
}

export function useHideProductArticle() {
  return useArticleWrite(
    async (id: string) =>
      unwrap(
        await api.POST(
          "/api/v1/admin/knowledge-base/product-articles/{article_id}/hide",
          BY_ID(id),
        ),
      ),
    (id) => id,
  );
}

export function useShowProductArticle() {
  return useArticleWrite(
    async (id: string) =>
      unwrap(
        await api.POST(
          "/api/v1/admin/knowledge-base/product-articles/{article_id}/show",
          BY_ID(id),
        ),
      ),
    (id) => id,
  );
}

/** Throw away the unpublished version of an own article. */
export function useDiscardProductDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<DiscardResult> =>
      unwrap(
        await api.POST(
          "/api/v1/admin/knowledge-base/product-articles/{article_id}/discard-draft",
          BY_ID(id),
        ),
      ),
    onSuccess: (result, id) => {
      if (result.article !== null) {
        remember(queryClient, result.article);
        return;
      }
      queryClient.removeQueries({
        queryKey: [...PRODUCT_ARTICLES_KEY, "detail", id],
      });
      void queryClient.invalidateQueries({
        queryKey: [...PRODUCT_ARTICLES_KEY, "list"],
      });
    },
  });
}
