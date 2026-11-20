import { Badge } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import type { ArticleStatus } from "./types";

const VARIANT: Record<ArticleStatus, "default" | "secondary" | "outline"> = {
  draft: "secondary",
  review: "outline",
  published: "default",
  withdrawn: "outline",
};

/**
 * Черновик / На проверке / Опубликована / Снята — one word, as in the list.
 *
 * A hidden built-in article stays «published» in the data, but «Опубликована»
 * next to «Скрыта из помощника» reads as two opposite answers to «does the
 * assistant use it»: a hidden one shows only the second.
 */
export function ArticleStatusBadge({
  status,
  hidden = false,
}: {
  status: ArticleStatus;
  hidden?: boolean;
}) {
  const { t } = useTranslation("articles");
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {hidden ? (
        <Badge variant="outline">{t("status.hidden")}</Badge>
      ) : (
        <Badge variant={VARIANT[status]}>{t(`status.${status}`)}</Badge>
      )}
    </span>
  );
}
