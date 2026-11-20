import {
  AsyncSection,
  Button,
  ConfirmDialog,
  EmptyState,
  SegmentedControl,
  WarningBanner,
  toast,
} from "@ketocare/ui";
import type { TFunction } from "i18next";
import { BookMarked, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { queryState } from "../../lib/queryState";
import { useSectionItem, useSectionTab } from "../../routes/useSectionTab";
import { ArticleEditor } from "./ArticleEditor";
import { ArticleList, ListSkeleton } from "./ArticleList";
import { ArticleLoading, ArticleView } from "./ArticleView";
import { FinishWarningsDialog } from "./FinishWarningsDialog";
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
  PRODUCT_TABS,
  useCreateProductArticle,
  useDiscardProductDraft,
  useHideProductArticle,
  useNewProductVersion,
  useProductArticle,
  useProductArticles,
  usePublishProductArticle,
  useShowProductArticle,
  useUpdateProductArticle,
  useWithdrawProductArticle,
  type ProductTab,
} from "./useProductArticles";

/**
 * «Статьи о приложении» — the administrator's section (ADR-0093).
 *
 * Two kinds side by side. Built-in articles ship with each release and are
 * updated by the developers: here they are read and, if one does not suit the
 * clinic, hidden from the assistant. Own articles the administrator writes and
 * publishes himself — a text about the app has no second reader, unlike a
 * clinical one. Clinical articles never appear here: the administrator has no
 * access to them, and the server does not list them for him.
 */
export function ProductArticlesPage() {
  const [item, setItem] = useSectionItem();
  const open = articleItemOf(item);

  if (open.mode === "new" || open.mode === "edit") {
    const articleId = open.mode === "edit" ? open.id : undefined;
    return (
      <ProductEditorScreen
        articleId={articleId}
        onDone={(id) => setItem(id)}
        onKeepEditing={(id) => setItem(editItem(id))}
        onCancel={() => setItem(articleId)}
      />
    );
  }
  if (open.mode === "view") {
    return (
      <ProductArticleScreen
        articleId={open.id}
        onBack={() => setItem(undefined)}
        onEdit={(id) => setItem(editItem(id))}
      />
    );
  }
  return (
    <ProductArticleListScreen
      onOpen={(id) => setItem(id)}
      onCreate={() => setItem(NEW_ARTICLE_ITEM)}
    />
  );
}

function ProductArticleListScreen({
  onOpen,
  onCreate,
}: {
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation("articles");
  const [tab, setTab] = useSectionTab<ProductTab>(
    "tab",
    PRODUCT_TABS,
    "builtin",
  );
  const articles = useProductArticles(tab);
  const items = articles.data?.items ?? [];

  return (
    <PageLayout
      title={t("product.title")}
      intro={t("product.intro")}
      width="content"
      actions={
        <Button type="button" className="min-h-touch" onClick={onCreate}>
          <Plus aria-hidden="true" />
          {t("actions.create")}
        </Button>
      }
    >
      <div className="flex flex-col gap-section">
        <SegmentedControl
          label={t("product.tabsLabel")}
          value={tab}
          onChange={setTab}
          items={PRODUCT_TABS.map((value) => ({
            value,
            label: t(`product.tabs.${value}`),
          }))}
          className="self-start"
        />
        <p className="m-0 text-muted-foreground">
          {t(`product.tabHint.${tab}`)}
        </p>

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
              icon={BookMarked}
              title={t(`product.empty.${tab}`)}
              action={
                tab === "own" ? (
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

function ProductEditorScreen({
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
  const article = useProductArticle(articleId);
  const create = useCreateProductArticle();
  const update = useUpdateProductArticle();
  const publish = usePublishProductArticle();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // A saved text whose warnings stopped «Опубликовать».
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
    return (
      <PageLayout
        title={data.title}
        width="content"
        onBack={onCancel}
        backLabel={t("actions.backToArticle")}
      >
        <EmptyState
          icon={BookMarked}
          title={t("editor.notEditable")}
          description={t("product.notEditableDescription")}
          action={
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("actions.backToArticle")}
            </Button>
          }
        />
      </PageLayout>
    );
  }

  async function publishSaved(saved: ArticleDetail) {
    // Publishing names the text just saved: the hash comes from the answer
    // to the save, not from what the form thinks it sent.
    setBusy(true);
    try {
      await publish.mutateAsync({
        id: saved.id,
        contentHash: saved.working_version.content_hash,
      });
      toast.success(t("toast.published"));
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
    // A published version carries no warnings any more: they are read here,
    // before the text reaches the families, or never.
    if (saved.warnings.length > 0) {
      setStopped(saved);
      return;
    }
    await publishSaved(saved);
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
        finishLabel={t("actions.publish")}
        finishHint={t("product.finishHint")}
        notice={
          data?.is_live && data.live_version_number !== null ? (
            <WarningBanner level="info">
              {t("product.editingLive", { number: data.live_version_number })}
            </WarningBanner>
          ) : null
        }
        busy={busy}
        error={error}
        onSubmit={(values, finish) => void handle(values, finish)}
        onCancel={onCancel}
      />
      <FinishWarningsDialog
        article={stopped}
        finishLabel={t("actions.publish")}
        onFinish={(saved) => {
          setStopped(null);
          void publishSaved(saved);
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

// --- the article ------------------------------------------------------------

function ProductArticleScreen({
  articleId,
  onBack,
  onEdit,
}: {
  articleId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}) {
  const article = useProductArticle(articleId);
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
    <ProductArticleView
      article={article.data}
      onBack={onBack}
      onEdit={onEdit}
    />
  );
}

type Confirm = "withdraw" | "hide" | "show" | "discard";

function ProductArticleView({
  article,
  onBack,
  onEdit,
}: {
  article: ArticleDetail;
  onBack: () => void;
  onEdit: (id: string) => void;
}) {
  const { t } = useTranslation("articles");
  const publish = usePublishProductArticle();
  const withdraw = useWithdrawProductArticle();
  const newVersion = useNewProductVersion();
  const hide = useHideProductArticle();
  const show = useShowProductArticle();
  const discard = useDiscardProductDraft();
  // The kind outlives the open flag: the dialog keeps its words while it closes.
  const [confirm, setConfirm] = useState<Confirm>("hide");
  const [confirmOpen, setConfirmOpen] = useState(false);
  function ask(kind: Confirm) {
    setConfirm(kind);
    setConfirmOpen(true);
  }

  const can = article.can;
  const several = article.versions.length > 1;
  const mutations = [publish, withdraw, newVersion, hide, show, discard];
  const busy = mutations.some((mutation) => mutation.isPending);
  const failure = mutations.find((mutation) => mutation.error !== null)?.error;

  const actions = (
    <>
      {can.publish && (
        <Button
          type="button"
          className="min-h-touch"
          disabled={busy}
          onClick={() =>
            publish.mutate(
              {
                id: article.id,
                contentHash: article.working_version.content_hash,
              },
              { onSuccess: () => toast.success(t("toast.published")) },
            )
          }
        >
          {t("actions.publish")}
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
      {can.withdraw && (
        <Button
          type="button"
          variant="outline"
          className="min-h-touch text-destructive"
          disabled={busy}
          onClick={() => ask("withdraw")}
        >
          {t("actions.withdraw")}
        </Button>
      )}
      {can.hide && (
        <Button
          type="button"
          variant="outline"
          className="min-h-touch"
          disabled={busy}
          onClick={() => ask("hide")}
        >
          {t("actions.hide")}
        </Button>
      )}
      {can.show && (
        <Button
          type="button"
          variant="outline"
          className="min-h-touch"
          disabled={busy}
          onClick={() => ask("show")}
        >
          {t("actions.show")}
        </Button>
      )}
      {can.discard && (
        <Button
          type="button"
          variant="outline"
          className="min-h-touch text-destructive"
          disabled={busy}
          onClick={() => ask("discard")}
        >
          {several ? t("actions.discardVersion") : t("actions.discardDraft")}
        </Button>
      )}
    </>
  );

  function onConfirm() {
    if (confirm === "withdraw") {
      withdraw.mutate(article.id, {
        onSuccess: () => toast.success(t("toast.withdrawn")),
      });
    } else if (confirm === "discard") {
      discard.mutate(article.id, {
        onSuccess: (result) => {
          toast.success(t("toast.discarded"));
          if (result.deleted) onBack();
        },
      });
    } else if (confirm === "hide") {
      hide.mutate(article.id, {
        onSuccess: () => toast.success(t("toast.hidden")),
      });
    } else {
      show.mutate(article.id, {
        onSuccess: () => toast.success(t("toast.shown")),
      });
    }
  }

  return (
    <>
      <ArticleView
        article={article}
        onBack={onBack}
        actions={actions}
        reviewed={false}
        status={productStatusText(article, t)}
        notices={
          failure !== undefined && failure !== null ? (
            <FormError>
              {errorMessageOf(failure) ?? t("common:errors.unexpected")}
            </FormError>
          ) : null
        }
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          confirm === "discard"
            ? several
              ? t("discard.versionTitle", {
                  title: article.title,
                  number: article.working_version.number,
                })
              : t("discard.draftTitle", { title: article.title })
            : t(`${confirm}.title`, { title: article.title })
        }
        description={
          confirm === "discard"
            ? several
              ? t("discard.versionDescription")
              : t("discard.draftDescription")
            : t(`${confirm}.description`)
        }
        confirmLabel={t(`${confirm}.confirm`)}
        cancelLabel={t("common:actions.cancel")}
        destructive={confirm !== "show"}
        onConfirm={onConfirm}
      />
    </>
  );
}

function productStatusText(article: ArticleDetail, t: TFunction): string {
  if (article.origin === "builtin") {
    return article.hidden
      ? t("product.state.builtinHidden")
      : article.is_live
        ? t("product.state.builtinLive")
        : t("product.state.builtinGone");
  }
  const live =
    article.is_live && article.status !== "published"
      ? ` ${t("product.state.liveMeanwhile", { number: article.live_version_number })}`
      : "";
  switch (article.status) {
    case "draft":
      return t("product.state.draft") + live;
    case "published":
      return t("product.state.published");
    default:
      return t("product.state.withdrawn");
  }
}
