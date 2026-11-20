import {
  AsyncSection,
  Section,
  Skeleton,
  type AsyncSectionProps,
} from "@ketocare/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { queryState, type QueryLike } from "../../lib/queryState";
import { ArticlePreview } from "./ArticlePreview";
import { ArticleStatusBadge } from "./ArticleStatusBadge";
import { GuardWarnings } from "./GuardWarnings";
import { VersionHistory } from "./VersionHistory";
import type { ArticleDetail } from "./types";

/**
 * The article page, shared by the clinical and the product sections.
 *
 * What may be done with the article (`actions`) and how its state reads
 * (`status`) differ between the two and come from the caller; the order of
 * the page does not: the state first, then what would stop the assistant,
 * then the text as the family sees it, then the history.
 *
 * While a new version of a live article is being written, the working version
 * is NOT what families read. The page then shows two texts and says which is
 * which: the draft (what the page's buttons act on) and the live version
 * («Как видит семья сейчас»). The header keeps the live title — the draft's
 * title is not the article's name until it is published.
 */
export function ArticleView({
  article,
  onBack,
  actions,
  status,
  notices,
  reviewed,
}: {
  article: ArticleDetail;
  onBack: () => void;
  /** Buttons of the page header; one of them at most is primary. */
  actions: ReactNode;
  /** The state in words: what it means and what happens next. */
  status: ReactNode;
  notices?: ReactNode;
  /** Clinical: each version is checked by a second specialist. */
  reviewed: boolean;
}) {
  const { t } = useTranslation("articles");
  const working = article.working_version;
  const live = article.versions.find((version) => version.is_live);
  const draftOverLive = live !== undefined && live.id !== working.id;

  return (
    <PageLayout
      title={draftOverLive ? live.title : article.title}
      width="content"
      onBack={onBack}
      backLabel={t("actions.backToList")}
      actions={actions}
    >
      <div className="flex flex-col gap-section">
        <div className="flex flex-col gap-field">
          <ArticleStatusBadge status={article.status} hidden={article.hidden} />
          <p className="m-0">{status}</p>
        </div>
        {notices}
        <GuardWarnings warnings={article.warnings} />
        {draftOverLive ? (
          <>
            <ArticlePreview
              title={working.title}
              body={working.body_md}
              heading={t("preview.draftTitle", { number: working.number })}
              description={t("preview.draftDescription", {
                number: live.number,
              })}
            />
            <ArticlePreview
              title={live.title}
              body={live.body_md}
              heading={t("preview.liveTitle", { number: live.number })}
              description={t("preview.description")}
            />
          </>
        ) : (
          <ArticlePreview title={working.title} body={working.body_md} />
        )}
        {working.sources !== null && working.sources.trim() !== "" && (
          <Section title={t("view.sources")} density="compact">
            <p className="m-0 whitespace-pre-line wrap-anywhere">
              {working.sources}
            </p>
          </Section>
        )}
        <VersionHistory versions={article.versions} reviewed={reviewed} />
      </div>
    </PageLayout>
  );
}

/**
 * The page while the article is on its way or could not be read: the same
 * frame (title, back), the five states of a data block inside it.
 */
export function ArticleLoading({
  query,
  error,
  onRetry,
  onBack,
}: {
  query: QueryLike;
  error: unknown;
  onRetry: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation("articles");
  const failure: AsyncSectionProps["error"] =
    error !== null && error !== undefined
      ? {
          title: t("view.loadError"),
          description: errorMessageOf(error) ?? t("common:errors.unexpected"),
        }
      : null;

  return (
    <PageLayout
      title={t("view.loadingTitle")}
      width="content"
      onBack={onBack}
      backLabel={t("actions.backToList")}
    >
      <AsyncSection
        {...queryState(query)}
        skeleton={
          <div className="flex flex-col gap-field" aria-busy="true">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        }
        error={failure}
        retryLabel={t("common:actions.retry")}
        onRetry={onRetry}
        isEmpty={false}
        empty={null}
      >
        {null}
      </AsyncSection>
    </PageLayout>
  );
}
