import { ChatText, Section } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

/**
 * «Как увидит семья»: the text through the same renderer as the assistant's
 * answers (`ChatText` of the kit). A second renderer here would show the
 * author one thing and the family another; and `ChatText` builds React
 * elements only, so whatever is pasted from Word never becomes HTML.
 */
export function ArticlePreview({
  title,
  body,
  heading,
  description,
  level = 2,
}: {
  title: string;
  body: string;
  /** Section heading; by default «Как увидит семья». */
  heading?: string;
  /** Line under the heading; by default only under «Как увидит семья». */
  description?: string;
  level?: 2 | 3;
}) {
  const { t } = useTranslation("articles");
  const empty = title.trim() === "" && body.trim() === "";

  return (
    <Section
      title={heading ?? t("preview.title")}
      description={
        description ??
        (heading === undefined ? t("preview.description") : undefined)
      }
      level={level}
      tone="muted"
    >
      {empty ? (
        <p className="m-0 text-muted-foreground">{t("preview.empty")}</p>
      ) : (
        <article className="flex flex-col gap-field">
          {title.trim() !== "" && (
            <p className="m-0 text-card-title font-semibold">{title}</p>
          )}
          <ChatText text={body} />
        </article>
      )}
    </Section>
  );
}
