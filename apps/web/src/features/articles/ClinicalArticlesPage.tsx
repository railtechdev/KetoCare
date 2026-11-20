import { zodResolver } from "@hookform/resolvers/zod";
import {
  AsyncSection,
  Button,
  ConfirmDialog,
  EmptyState,
  FormFooter,
  FormSheet,
  SegmentedControl,
  WarningBanner,
  toast,
} from "@ketocare/ui";
import type { TFunction } from "i18next";
import { BookOpen, Plus } from "lucide-react";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { TextAreaField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import {
  FormErrorSummary,
  errorSummaryItems,
} from "../../components/FormErrorSummary";
import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { queryState } from "../../lib/queryState";
import { useSectionItem, useSectionTab } from "../../routes/useSectionTab";
import { ArticleEditor } from "./ArticleEditor";
import { ArticleList, ListSkeleton } from "./ArticleList";
import { ArticleLoading, ArticleView } from "./ArticleView";
import { FinishWarningsDialog } from "./FinishWarningsDialog";
import { personAndDay } from "./format";
import {
  NEW_ARTICLE_ITEM,
  articleItemOf,
  editItem,
  formValuesOf,
  writeBodyOf,
  type ArticleDetail,
  type ArticleFormValues,
} from "./types";
import {
  CLINICAL_FILTERS,
  useClinicalArticle,
  useClinicalArticles,
  useClinicalReviewCount,
  useCreateClinicalArticle,
  useDiscardClinicalDraft,
  useNewClinicalVersion,
  usePublishClinicalArticle,
  useReturnClinicalArticle,
  useSubmitClinicalArticle,
  useUpdateClinicalArticle,
  useWithdrawClinicalArticle,
  type ClinicalFilter,
} from "./useClinicalArticles";

/**
 * «Статьи для семей» — the clinical articles of the family assistant
 * (ADR-0093), for the doctor and the dietitian.
 *
 * Four eyes: anyone writes, ANOTHER specialist publishes. The buttons follow
 * the server's `can.*` and nothing else — the server enforces the same rule,
 * and a second copy of it here would one day disagree with the first. Where
 * the server still refuses (the text changed while it was read, the author
 * tries to publish), its message is shown as is.
 *
 * What is open lives in the address (`?item=`), the list filter in `?tab=`.
 */
export function ClinicalArticlesPage() {
  const [item, setItem] = useSectionItem();
  const open = articleItemOf(item);

  if (open.mode === "new" || open.mode === "edit") {
    const articleId = open.mode === "edit" ? open.id : undefined;
    return (
      <ClinicalEditorScreen
        articleId={articleId}
        onDone={(id) => setItem(id)}
        onKeepEditing={(id) => setItem(editItem(id))}
        onCancel={() => setItem(articleId)}
      />
    );
  }
  if (open.mode === "view") {
    return (
      <ClinicalArticleScreen
        articleId={open.id}
        onBack={() => setItem(undefined)}
        onEdit={(id) => setItem(editItem(id))}
      />
    );
  }
  return (
    <ClinicalArticleListScreen
      onOpen={(id) => setItem(id)}
      onCreate={() => setItem(NEW_ARTICLE_ITEM)}
    />
  );
}

function ClinicalArticleListScreen({
  onOpen,
  onCreate,
}: {
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation("articles");
  const [filter, setFilter] = useSectionTab<ClinicalFilter>(
    "tab",
    CLINICAL_FILTERS,
    "all",
  );
  const articles = useClinicalArticles(filter);
  const reviewCount = useClinicalReviewCount();
  const items = articles.data?.items ?? [];
  const waiting = reviewCount.data ?? 0;

  return (
    <PageLayout
      title={t("clinical.title")}
      intro={t("clinical.intro")}
      width="content"
      actions={
        <Button type="button" className="min-h-touch" onClick={onCreate}>
          <Plus aria-hidden="true" />
          {t("actions.create")}
        </Button>
      }
    >
      <div className="flex flex-col gap-section">
        {/* The navigation has no counters; the reviewer learns about the
            waiting articles here, at the top of the section. */}
        {waiting > 0 && filter !== "review" && (
          <WarningBanner
            level="info"
            title={t("clinical.reviewBanner", { number: waiting })}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-field"
              onClick={() => setFilter("review")}
            >
              {t("clinical.reviewBannerAction")}
            </Button>
          </WarningBanner>
        )}

        <SegmentedControl
          label={t("clinical.filterLabel")}
          value={filter}
          onChange={setFilter}
          items={CLINICAL_FILTERS.map((value) => ({
            value,
            label: t(`clinical.filters.${value}`),
          }))}
          className="self-start"
        />

        <AsyncSection
          {...queryState(articles)}
          skeleton={<ListSkeleton />}
          error={
            articles.isError
              ? {
                  title: t("list.loadError"),
                  description:
                    errorMessageOf(articles.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void articles.refetch()}
          isEmpty={items.length === 0}
          empty={
            <EmptyState
              icon={BookOpen}
              title={t(`clinical.empty.${filter}`)}
              description={
                filter === "all" ? t("clinical.emptyDescription") : undefined
              }
              action={
                filter === "all" ? (
                  <Button type="button" onClick={onCreate}>
                    <Plus aria-hidden="true" />
                    {t("actions.create")}
                  </Button>
                ) : undefined
              }
            />
          }
        >
          <ArticleList
            articles={items}
            total={articles.data?.total ?? items.length}
            onOpen={onOpen}
          />
        </AsyncSection>
      </div>
    </PageLayout>
  );
}

// --- editor -----------------------------------------------------------------

function ClinicalEditorScreen({
  articleId,
  onDone,
  onKeepEditing,
  onCancel,
}: {
  articleId: string | undefined;
  onDone: (id: string) => void;
  /** Stay in the editor of the saved article (a new one gets its address). */
  onKeepEditing: (id: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("articles");
  const article = useClinicalArticle(articleId);
  const create = useCreateClinicalArticle();
  const update = useUpdateClinicalArticle();
  const submit = useSubmitClinicalArticle();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // A saved text whose warnings stopped «Отправить на проверку».
  const [stopped, setStopped] = useState<ArticleDetail | null>(null);

  if (articleId !== undefined && article.data === undefined) {
    return (
      <ArticleLoading
        query={article}
        error={article.error}
        onRetry={() => void article.refetch()}
        onBack={onCancel}
      />
    );
  }

  const data = article.data;
  if (data !== undefined && !data.can.edit) {
    return <NotEditable article={data} onBack={onCancel} />;
  }

  async function submitSaved(saved: ArticleDetail) {
    // The text is saved either way; a refused submit leaves a draft, and the
    // author lands on it with the reason instead of a second «create».
    setBusy(true);
    try {
      await submit.mutateAsync(saved.id);
      toast.success(t("toast.submitted"));
    } catch (failure) {
      toast.error(errorMessageOf(failure) ?? t("common:errors.unexpected"));
    }
    setBusy(false);
    onDone(saved.id);
  }

  async function handle(values: ArticleFormValues, finish: boolean) {
    setBusy(true);
    setError(null);
    let saved: ArticleDetail;
    try {
      const body = writeBodyOf(values);
      saved =
        articleId === undefined
          ? await create.mutateAsync(body)
          : await update.mutateAsync({ id: articleId, body });
    } catch (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!finish) {
      toast.success(t("toast.saved"));
      onDone(saved.id);
      return;
    }
    // What the assistant could not repeat is read BEFORE the text goes to
    // review, not discovered on its page afterwards.
    if (saved.warnings.length > 0) {
      setStopped(saved);
      return;
    }
    await submitSaved(saved);
  }

  const working = data?.working_version;
  return (
    <>
      <ArticleEditor
        key={working?.id ?? "new"}
        pageTitle={
          data === undefined ? t("editor.newTitle") : t("editor.editTitle")
        }
        initial={formValuesOf(working)}
        warnings={stopped?.warnings ?? data?.warnings ?? []}
        finishLabel={t("actions.submit")}
        finishHint={t("clinical.finishHint")}
        notice={
          data === undefined ? null : (
            <>
              {data.status === "review" && (
                <WarningBanner level="info">
                  {t("clinical.editingReview")}
                </WarningBanner>
              )}
              {data.is_live && data.live_version_number !== null && (
                <WarningBanner level="info">
                  {t("clinical.editingLive", {
                    number: data.live_version_number,
                  })}
                </WarningBanner>
              )}
              <ReturnedNotice article={data} />
            </>
          )
        }
        busy={busy}
        error={error}
        onSubmit={(values, finish) => void handle(values, finish)}
        onCancel={onCancel}
      />
      <FinishWarningsDialog
        article={stopped}
        finishLabel={t("actions.submit")}
        onFinish={(saved) => {
          setStopped(null);
          void submitSaved(saved);
        }}
        onKeepDraft={(saved) => {
          setStopped(null);
          toast.success(t("toast.saved"));
          onKeepEditing(saved.id);
        }}
      />
    </>
  );
}

function NotEditable({
  article,
  onBack,
}: {
  article: ArticleDetail;
  onBack: () => void;
}) {
  const { t } = useTranslation("articles");
  return (
    <PageLayout
      title={article.title}
      width="content"
      onBack={onBack}
      backLabel={t("actions.backToArticle")}
    >
      <EmptyState
        icon={BookOpen}
        title={t("editor.notEditable")}
        description={t("editor.notEditableDescription")}
        action={
          <Button type="button" variant="outline" onClick={onBack}>
            {t("actions.backToArticle")}
          </Button>
        }
      />
    </PageLayout>
  );
}

/** The reviewer's comment, shown to the author until the text is sent again. */
function ReturnedNotice({ article }: { article: ArticleDetail }) {
  const { t } = useTranslation("articles");
  const working = article.working_version;
  if (article.status !== "draft" || working.return_comment === null) {
    return null;
  }
  return (
    <WarningBanner
      level="warning"
      title={t("clinical.returnedTitle", {
        who: personAndDay(
          working.returned_by_name,
          working.returned_at,
          t("history.unknownPerson"),
        ),
      })}
    >
      <p className="m-0 whitespace-pre-line">{working.return_comment}</p>
    </WarningBanner>
  );
}

// --- the article ------------------------------------------------------------

function ClinicalArticleScreen({
  articleId,
  onBack,
  onEdit,
}: {
  articleId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}) {
  const article = useClinicalArticle(articleId);

  if (article.data === undefined) {
    return (
      <ArticleLoading
        query={article}
        error={article.error}
        onRetry={() => void article.refetch()}
        onBack={onBack}
      />
    );
  }
  return (
    <ClinicalArticleView
      // The text the reviewer started reading is pinned per article.
      key={article.data.id}
      article={article.data}
      onBack={onBack}
      onEdit={onEdit}
    />
  );
}

function ClinicalArticleView({
  article,
  onBack,
  onEdit,
}: {
  article: ArticleDetail;
  onBack: () => void;
  onEdit: (id: string) => void;
}) {
  const { t } = useTranslation("articles");
  const submit = useSubmitClinicalArticle();
  const publish = usePublishClinicalArticle();
  const withdraw = useWithdrawClinicalArticle();
  const newVersion = useNewClinicalVersion();
  const discard = useDiscardClinicalDraft();
  const [returning, setReturning] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const can = article.can;
  const working = article.working_version;
  // The decision is about the text the reviewer READ, not about whatever the
  // last background refetch brought: the hash is pinned when the version is
  // first shown, and a text that changed since (the author edited it in the
  // meantime) has to be acknowledged before publish or return — otherwise the
  // page would echo the newest hash, and the server's `content_changed` check
  // would never fire.
  const [seen, setSeen] = useState(() => ({
    id: working.id,
    hash: working.content_hash,
  }));
  const changed = seen.id !== working.id || seen.hash !== working.content_hash;
  const decides = can.publish || can.return_to_author;
  const failure =
    submit.error ??
    publish.error ??
    withdraw.error ??
    newVersion.error ??
    discard.error;
  const busy =
    submit.isPending ||
    publish.isPending ||
    withdraw.isPending ||
    newVersion.isPending ||
    discard.isPending;
  const mineOnReview = article.status === "review" && can.edit;

  const actions = (
    <>
      {can.publish && (
        <Button
          type="button"
          className="min-h-touch"
          disabled={busy || changed}
          onClick={() =>
            publish.mutate(
              { id: article.id, contentHash: seen.hash },
              { onSuccess: () => toast.success(t("toast.published")) },
            )
          }
        >
          {t("actions.publish")}
        </Button>
      )}
      {can.return_to_author && (
        <Button
          type="button"
          variant="outline"
          className="min-h-touch"
          disabled={busy || changed}
          onClick={() => setReturning(true)}
        >
          {t("actions.return")}
        </Button>
      )}
      {can.submit && (
        <Button
          type="button"
          className="min-h-touch"
          disabled={busy}
          onClick={() =>
            submit.mutate(article.id, {
              onSuccess: () => toast.success(t("toast.submitted")),
            })
          }
        >
          {t("actions.submit")}
        </Button>
      )}
      {can.edit && (
        <Button
          type="button"
          variant="outline"
          className="min-h-touch"
          disabled={busy}
          onClick={() => onEdit(article.id)}
        >
          {t("actions.edit")}
        </Button>
      )}
      {can.new_version && (
        <Button
          type="button"
          className="min-h-touch"
          disabled={busy}
          onClick={() =>
            newVersion.mutate(article.id, {
              onSuccess: (next) => onEdit(next.id),
            })
          }
        >
          {t("actions.edit")}
        </Button>
      )}
      {mineOnReview && (
        <Button
          type="button"
          variant="outline"
          className="min-h-touch"
          onClick={() =>
            void copyText(window.location.href).then((copied) =>
              copied
                ? toast.success(t("toast.linkCopied"))
                : toast.error(t("toast.linkNotCopied")),
            )
          }
        >
          {t("actions.copyLink")}
        </Button>
      )}
      {can.withdraw && (
        <Button
          type="button"
          variant="outline"
          className="min-h-touch text-destructive"
          disabled={busy}
          onClick={() => setConfirmWithdraw(true)}
        >
          {t("actions.withdraw")}
        </Button>
      )}
      {can.discard && (
        <Button
          type="button"
          variant="outline"
          className="min-h-touch text-destructive"
          disabled={busy}
          onClick={() => setConfirmDiscard(true)}
        >
          {article.versions.length > 1
            ? t("actions.discardVersion")
            : t("actions.discardDraft")}
        </Button>
      )}
    </>
  );

  return (
    <>
      <ArticleView
        article={article}
        onBack={onBack}
        actions={actions}
        reviewed
        status={clinicalStatusText(article, t)}
        notices={
          <>
            {failure !== null && (
              <FormError>
                {errorMessageOf(failure) ?? t("common:errors.unexpected")}
              </FormError>
            )}
            {changed && decides && (
              <WarningBanner
                level="warning"
                title={t("clinical.changed.title")}
              >
                <p className="m-0">{t("clinical.changed.description")}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-field"
                  onClick={() =>
                    setSeen({ id: working.id, hash: working.content_hash })
                  }
                >
                  {t("clinical.changed.reread")}
                </Button>
              </WarningBanner>
            )}
            {can.new_version && article.is_live && (
              <p className="m-0 text-sm text-muted-foreground">
                {t("clinical.newVersionHint")}
              </p>
            )}
            <ReturnedNotice article={article} />
          </>
        }
      />

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={
          article.versions.length > 1
            ? t("discard.versionTitle", {
                title: article.title,
                number: working.number,
              })
            : t("discard.draftTitle", { title: article.title })
        }
        description={
          article.versions.length > 1
            ? t("discard.versionDescription")
            : t("discard.draftDescription")
        }
        confirmLabel={t("discard.confirm")}
        cancelLabel={t("common:actions.cancel")}
        destructive
        onConfirm={() =>
          discard.mutate(article.id, {
            onSuccess: (result) => {
              toast.success(t("toast.discarded"));
              if (result.deleted) onBack();
            },
          })
        }
      />

      <ConfirmDialog
        open={confirmWithdraw}
        onOpenChange={setConfirmWithdraw}
        title={t("withdraw.title", { title: article.title })}
        description={t("withdraw.description")}
        confirmLabel={t("withdraw.confirm")}
        cancelLabel={t("common:actions.cancel")}
        destructive
        onConfirm={() =>
          withdraw.mutate(article.id, {
            onSuccess: () => toast.success(t("toast.withdrawn")),
          })
        }
      />

      <ReturnSheet
        open={returning}
        onOpenChange={setReturning}
        article={article}
        contentHash={seen.hash}
      />
    </>
  );
}

/** What the state means to this reader, and what happens next. */
function clinicalStatusText(article: ArticleDetail, t: TFunction): string {
  const live =
    article.is_live && article.status !== "published"
      ? ` ${t("clinical.state.liveMeanwhile", { number: article.live_version_number })}`
      : "";
  const author = article.working_author_name ?? t("history.unknownPerson");
  switch (article.status) {
    case "draft":
      return (
        (article.can.submit
          ? t("clinical.state.draftMine")
          : t("clinical.state.draftOther", { author })) + live
      );
    case "review":
      return (
        (article.can.publish
          ? t("clinical.state.reviewForMe", { author })
          : article.can.edit
            ? t("clinical.state.reviewMine")
            : t("clinical.state.reviewOther", { author })) + live
      );
    case "published":
      return t("clinical.state.published");
    default:
      return t("clinical.state.withdrawn");
  }
}

const returnSchema = z.object({ comment: z.string().trim().min(1) });
type ReturnValues = z.infer<typeof returnSchema>;

/**
 * «Вернуть автору»: the comment is required — a text returned without a word
 * leaves the author guessing what to fix.
 */
function ReturnSheet({
  open,
  onOpenChange,
  article,
  contentHash,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  article: ArticleDetail;
  /** The text the reviewer read — pinned by the page, not the latest fetch. */
  contentHash: string;
}) {
  const { t } = useTranslation("articles");
  const ids = useId();
  const giveBack = useReturnClinicalArticle();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, submitCount },
  } = useForm<ReturnValues>({
    resolver: zodResolver(returnSchema),
    defaultValues: { comment: "" },
  });
  const commentError = errors.comment && t("returnForm.commentRequired");

  function close() {
    onOpenChange(false);
    reset({ comment: "" });
    giveBack.reset();
  }

  return (
    <FormSheet
      closeLabel={t("common:actions.close")}
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("returnForm.title", { title: article.title })}
      description={t("returnForm.description")}
    >
      <form
        noValidate
        className="flex flex-col gap-section"
        onSubmit={handleSubmit((values) =>
          giveBack.mutate(
            {
              id: article.id,
              contentHash,
              comment: values.comment.trim(),
            },
            {
              onSuccess: () => {
                toast.success(t("toast.returned"));
                close();
              },
            },
          ),
        )}
      >
        <FormErrorSummary
          items={errorSummaryItems(submitCount, [
            [`${ids}-comment`, commentError],
          ])}
          focusKey={submitCount}
        />
        <TextAreaField
          id={`${ids}-comment`}
          label={t("returnForm.comment")}
          hint={t("returnForm.commentHint")}
          rows={5}
          error={commentError}
          {...register("comment")}
        />
        {giveBack.isError && (
          <FormError>
            {errorMessageOf(giveBack.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}
        <FormFooter
          submitLabel={t("returnForm.submit")}
          pendingLabel={t("actions.saving")}
          pending={giveBack.isPending}
          onCancel={close}
          cancelLabel={t("common:actions.cancel")}
        />
      </form>
    </FormSheet>
  );
}
