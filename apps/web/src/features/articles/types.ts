import type { components } from "@ketocare/api-client";

type Schemas = components["schemas"];

export type ArticleSummary = Schemas["KbArticleSummary"];
export type ArticleDetail = Schemas["KbArticleDetail"];
export type ArticleVersion = Schemas["KbVersionRead"];
export type GuardWarning = Schemas["KbGuardWarning"];
export type ArticleWriteBody = Schemas["KbArticleWrite"];
export type ArticleText = Schemas["KbArticleText"];
export type DiscardResult = Schemas["KbDiscardResult"];
export type ArticleStatus = ArticleSummary["status"];
export type GuardWarningKind = GuardWarning["kind"];

/**
 * Upper bound of one page (`MAX_PAGE_SIZE` of the API). Articles are counted in
 * dozens, not thousands: the list shows the first page and says so when there
 * are more.
 */
export const ARTICLES_PAGE_SIZE = 200;

/**
 * What is open inside the section (`?item=`): the list, a new article, the
 * editor of an article or the article itself. In the address, not in state
 * (rule П1): a specialist sends a colleague the link «check this one», and F5
 * in the middle of a long text must not throw the reader back to the list.
 */
export type ArticleItem =
  | { mode: "list" }
  | { mode: "new" }
  | { mode: "edit"; id: string }
  | { mode: "view"; id: string };

export const NEW_ARTICLE_ITEM = "new";
const EDIT_PREFIX = "edit:";

export function articleItemOf(item: string | undefined): ArticleItem {
  if (item === undefined) return { mode: "list" };
  if (item === NEW_ARTICLE_ITEM) return { mode: "new" };
  if (item.startsWith(EDIT_PREFIX)) {
    const id = item.slice(EDIT_PREFIX.length);
    return id === "" ? { mode: "list" } : { mode: "edit", id };
  }
  return { mode: "view", id: item };
}

export function editItem(id: string): string {
  return `${EDIT_PREFIX}${id}`;
}

/** Form values of the editor: the write body with the optional fields as text. */
export interface ArticleFormValues {
  title: string;
  body_md: string;
  sources: string;
  source_file_name: string;
}

export function formValuesOf(version?: ArticleVersion): ArticleFormValues {
  return {
    title: version?.title ?? "",
    body_md: version?.body_md ?? "",
    sources: version?.sources ?? "",
    source_file_name: version?.source_file_name ?? "",
  };
}

export function writeBodyOf(values: ArticleFormValues): ArticleWriteBody {
  const sources = values.sources.trim();
  const fileName = values.source_file_name.trim();
  return {
    title: values.title.trim(),
    body_md: values.body_md.trim(),
    sources: sources === "" ? null : sources,
    source_file_name: fileName === "" ? null : fileName,
  };
}
