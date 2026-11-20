import { Badge, Button, Section } from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ArticlePreview } from "./ArticlePreview";
import { personAndDay } from "./format";
import type { ArticleVersion } from "./types";

/**
 * Every version of the article, newest first — read only.
 *
 * A published version never changes (it is what families were told on those
 * days), so the history is the answer to «what did the assistant say in
 * October»: open the version and read its text.
 */
export function VersionHistory({
  versions,
  reviewed,
}: {
  versions: ArticleVersion[];
  /** Clinical: the version was checked by a second specialist. */
  reviewed: boolean;
}) {
  const { t } = useTranslation("articles");
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Section title={t("history.title")} density="compact">
      <ol className="m-0 flex list-none flex-col gap-section p-0">
        {versions.map((version) => {
          const open = openId === version.id;
          return (
            <li
              key={version.id}
              className="flex flex-col gap-field border-b border-border pb-section last:border-b-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-field">
                <span className="font-semibold">
                  {t("history.version", { number: version.number })}
                </span>
                {version.is_live && (
                  <Badge variant="default">{t("history.live")}</Badge>
                )}
              </div>
              <dl className="m-0 flex flex-col gap-1 text-sm">
                <HistoryFact
                  label={t("history.author")}
                  value={personAndDay(
                    version.author_name,
                    version.created_at,
                    t("history.unknownPerson"),
                  )}
                />
                {version.approved_at !== null && (
                  <HistoryFact
                    label={
                      reviewed ? t("history.checked") : t("history.published")
                    }
                    value={personAndDay(
                      version.approver_name,
                      version.approved_at,
                      t("history.unknownPerson"),
                    )}
                  />
                )}
                {version.returned_at !== null && (
                  <HistoryFact
                    label={t("history.returned")}
                    value={personAndDay(
                      version.returned_by_name,
                      version.returned_at,
                      t("history.unknownPerson"),
                    )}
                  />
                )}
                {version.return_comment !== null && (
                  <HistoryFact
                    label={t("history.comment")}
                    value={version.return_comment}
                  />
                )}
              </dl>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : version.id)}
              >
                {open ? t("history.hideText") : t("history.showText")}
              </Button>
              {open && (
                <ArticlePreview
                  title={version.title}
                  body={version.body_md}
                  heading={t("history.textOf", { number: version.number })}
                  level={3}
                />
              )}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function HistoryFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0">{value}</dd>
    </div>
  );
}
