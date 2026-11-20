import { ConfirmDialog } from "@ketocare/ui";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { GuardWarnings } from "./GuardWarnings";
import type { ArticleDetail } from "./types";

/**
 * «Отправить / опубликовать, хотя помощник не сможет это пересказать?»
 *
 * The warnings are known only after the text is saved, and finishing used to
 * go on in the same click: the author first saw them on a text already on
 * review, and the administrator — never, his article being live at once. Now
 * the save stops here, the warnings are read, and finishing is a decision.
 * Declining keeps the saved draft.
 */
export function FinishWarningsDialog({
  article,
  finishLabel,
  onFinish,
  onKeepDraft,
}: {
  /** The just saved article whose warnings stopped finishing; null — closed. */
  article: ArticleDetail | null;
  finishLabel: string;
  onFinish: (article: ArticleDetail) => void;
  onKeepDraft: (article: ArticleDetail) => void;
}) {
  const { t } = useTranslation("articles");
  // The confirm button closes the dialog too; closing after it is not
  // «keep the draft».
  const finished = useRef<ArticleDetail | null>(null);
  return (
    <ConfirmDialog
      open={article !== null}
      onOpenChange={(open) => {
        if (open || article === null) return;
        if (finished.current !== article) onKeepDraft(article);
      }}
      title={t("finishWarnings.title", {
        title: article?.title ?? "",
        number: article?.warnings.length ?? 0,
      })}
      description={t("finishWarnings.description")}
      confirmLabel={finishLabel}
      cancelLabel={t("finishWarnings.keepDraft")}
      destructive={false}
      onConfirm={() => {
        if (article === null) return;
        finished.current = article;
        onFinish(article);
      }}
    >
      <GuardWarnings warnings={article?.warnings ?? []} />
    </ConfirmDialog>
  );
}
