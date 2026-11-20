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
 * Clinical articles of the family assistant (ADR-0093): doctor and dietitian
 * only. Every write answers with the whole article, and the answer goes into
 * the cache as is: `can.*`, the warnings and the content hash are the server's
 * decision, and recomputing them here would be a second set of rules.
 */
export const CLINICAL_ARTICLES_KEY = ["kb-articles", "clinical"] as const;

export const CLINICAL_FILTERS = [
  "all",
  "review",
  "drafts",
  "published",
] as const;

export type ClinicalFilter = (typeof CLINICAL_FILTERS)[number];

function filterQuery(filter: ClinicalFilter) {
  switch (filter) {
    case "review":
      return { awaiting_my_review: true };
    case "drafts":
      return { status: "draft" as const };
    // «Опубликованные» — те, по которым помощник отвечает сейчас: у статьи с
    // черновиком правки рабочая редакция — черновик, а живой остаётся
    // прежняя, и по `status` такая статья из списка пропадала бы.
    case "published":
      return { live: true };
    default:
      return {};
  }
}

export function useClinicalArticles(filter: ClinicalFilter) {
  return useQuery({
    queryKey: [...CLINICAL_ARTICLES_KEY, "list", filter],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/knowledge-base/clinical-articles",
        {
          params: {
            query: { ...filterQuery(filter), limit: ARTICLES_PAGE_SIZE },
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty articles response");
      return data;
    },
  });
}

/** Articles waiting for MY review: the banner over the list. */
export function useClinicalReviewCount() {
  return useQuery({
    queryKey: [...CLINICAL_ARTICLES_KEY, "review-count"],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/knowledge-base/clinical-articles/review-count",
      );
      if (error || !data) throw error ?? new Error("Empty count response");
      return data.count;
    },
  });
}

export function useClinicalArticle(articleId: string | undefined) {
  return useQuery({
    queryKey: [...CLINICAL_ARTICLES_KEY, "detail", articleId],
    enabled: articleId !== undefined,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/knowledge-base/clinical-articles/{article_id}",
        { params: { path: { article_id: articleId ?? "" } } },
      );
      if (error || !data) throw error ?? new Error("Empty article response");
      return data;
    },
  });
}

function remember(queryClient: QueryClient, article: ArticleDetail) {
  queryClient.setQueryData(
    [...CLINICAL_ARTICLES_KEY, "detail", article.id],
    article,
  );
  void queryClient.invalidateQueries({
    queryKey: [...CLINICAL_ARTICLES_KEY, "list"],
  });
  void queryClient.invalidateQueries({
    queryKey: [...CLINICAL_ARTICLES_KEY, "review-count"],
  });
}

/**
 * A refused decision re-reads the article: the usual refusal here is
 * «the text changed while you were reading» (409 `content_changed`), and the
 * reviewer must see the new text before deciding again.
 */
function reread(queryClient: QueryClient, articleId: string) {
  void queryClient.invalidateQueries({
    queryKey: [...CLINICAL_ARTICLES_KEY, "detail", articleId],
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
      if (articleIdOf !== undefined) reread(queryClient, articleIdOf(input));
    },
  });
}

function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error || !result.data) {
    throw result.error ?? new Error("Empty article response");
  }
  return result.data;
}

export function useCreateClinicalArticle() {
  return useArticleWrite(async (body: ArticleWriteBody) =>
    unwrap(
      await api.POST("/api/v1/knowledge-base/clinical-articles", { body }),
    ),
  );
}

export function useUpdateClinicalArticle() {
  return useArticleWrite(
    async (input: { id: string; body: ArticleWriteBody }) =>
      unwrap(
        await api.PUT("/api/v1/knowledge-base/clinical-articles/{article_id}", {
          params: { path: { article_id: input.id } },
          body: input.body,
        }),
      ),
    (input) => input.id,
  );
}

export function useSubmitClinicalArticle() {
  return useArticleWrite(
    async (id: string) =>
      unwrap(
        await api.POST(
          "/api/v1/knowledge-base/clinical-articles/{article_id}/submit",
          { params: { path: { article_id: id } } },
        ),
      ),
    (id) => id,
  );
}

export function usePublishClinicalArticle() {
  return useArticleWrite(
    async (input: { id: string; contentHash: string }) =>
      unwrap(
        await api.POST(
          "/api/v1/knowledge-base/clinical-articles/{article_id}/publish",
          {
            params: { path: { article_id: input.id } },
            body: { content_hash: input.contentHash },
          },
        ),
      ),
    (input) => input.id,
  );
}

export function useReturnClinicalArticle() {
  return useArticleWrite(
    async (input: { id: string; contentHash: string; comment: string }) =>
      unwrap(
        await api.POST(
          "/api/v1/knowledge-base/clinical-articles/{article_id}/return",
          {
            params: { path: { article_id: input.id } },
            body: { content_hash: input.contentHash, comment: input.comment },
          },
        ),
      ),
    (input) => input.id,
  );
}

export function useWithdrawClinicalArticle() {
  return useArticleWrite(
    async (id: string) =>
      unwrap(
        await api.POST(
          "/api/v1/knowledge-base/clinical-articles/{article_id}/withdraw",
          { params: { path: { article_id: id } } },
        ),
      ),
    (id) => id,
  );
}

export function useNewClinicalVersion() {
  return useArticleWrite(
    async (id: string) =>
      unwrap(
        await api.POST(
          "/api/v1/knowledge-base/clinical-articles/{article_id}/new-version",
          { params: { path: { article_id: id } } },
        ),
      ),
    (id) => id,
  );
}

/**
 * Throw away the unpublished working version. The answer is the article as it
 * is now, or `deleted` when it had never been published.
 */
export function useDiscardClinicalDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<DiscardResult> =>
      unwrap(
        await api.POST(
          "/api/v1/knowledge-base/clinical-articles/{article_id}/discard-draft",
          { params: { path: { article_id: id } } },
        ),
      ),
    onSuccess: (result, id) => {
      if (result.article !== null) {
        remember(queryClient, result.article);
        return;
      }
      queryClient.removeQueries({
        queryKey: [...CLINICAL_ARTICLES_KEY, "detail", id],
      });
      void queryClient.invalidateQueries({
        queryKey: [...CLINICAL_ARTICLES_KEY, "list"],
      });
      void queryClient.invalidateQueries({
        queryKey: [...CLINICAL_ARTICLES_KEY, "review-count"],
      });
    },
    onError: (_error, id) => reread(queryClient, id),
  });
}
