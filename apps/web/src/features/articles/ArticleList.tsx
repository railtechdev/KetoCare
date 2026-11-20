import { Badge, Skeleton } from "@ketocare/ui";
import { ChevronRight } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { ArticleStatusBadge } from "./ArticleStatusBadge";
import { formatArticleDay } from "./format";
import type { ArticleSummary } from "./types";

/**
 * Articles one per row: the title, the state in one word, who wrote the
 * current version and when it changed. A row opens the article; nothing is
 * done from the list itself — publishing and withdrawing are decisions taken
 * after reading, on the article's own page.
 */
export function ArticleList({
  articles,
  total,
  onOpen,
}: {
  articles: ArticleSummary[];
  total: number;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation("articles");

  return (
    <div className="flex flex-col gap-field">
      <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-xl border border-border bg-card p-0">
        {articles.map((article) => (
          <li key={article.id}>
            <button
              type="button"
              onClick={() => onOpen(article.id)}
              className="flex min-h-touch w-full items-center gap-field px-4 py-3 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-semibold wrap-anywhere">
                  {article.title}
                </span>
                <span className="flex flex-wrap items-center gap-field">
                  <ArticleStatusBadge
                    status={article.status}
                    hidden={article.hidden}
                  />
                  {article.awaiting_my_review && (
                    <Badge variant="default">{t("list.awaitingMe")}</Badge>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {metaLine(article, t)}
                  {article.is_live &&
                    article.status !== "published" &&
                    article.live_version_number !== null && (
                      <>
                        {" · "}
                        {t("list.liveVersion", {
                          number: article.live_version_number,
                        })}
                      </>
                    )}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            </button>
          </li>
        ))}
      </ul>
      {total > articles.length && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("list.firstOf", { shown: articles.length, total })}
        </p>
      )}
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div className="flex flex-col gap-field" aria-busy="true">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

/**
 * The line under the title: for a live article the signature that put it
 * in front of families (who checked or published it, and when) — an imported
 * clinical article was written for the release and signed by the clinic, so
 * «Автор: KetoCare» alone would misstate who stands behind it. A built-in
 * article comes with the app; a draft shows who is writing it.
 */
function metaLine(article: ArticleSummary, t: TFunction): string {
  if (article.origin === "builtin") {
    return t("list.metaBuiltin", { day: formatArticleDay(article.updated_at) });
  }
  if (
    article.is_live &&
    article.live_approver_name != null &&
    article.live_approved_at != null
  ) {
    return t(
      article.kind === "clinical" ? "list.metaChecked" : "list.metaPublished",
      {
        person: article.live_approver_name,
        day: formatArticleDay(article.live_approved_at),
      },
    );
  }
  return t("list.meta", {
    author: article.working_author_name ?? t("history.unknownPerson"),
    day: formatArticleDay(article.updated_at),
  });
}
