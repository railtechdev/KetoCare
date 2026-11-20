import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Columns,
  ConfirmDialog,
  Section,
  StatusNote,
} from "@ketocare/ui";
import { useId, useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { FileField, Field, TextAreaField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import {
  FormErrorSummary,
  errorSummaryItems,
} from "../../components/FormErrorSummary";
import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { ArticlePreview } from "./ArticlePreview";
import { GuardWarnings } from "./GuardWarnings";
import type { ArticleFormValues, ArticleText, GuardWarning } from "./types";
import { useArticleTextMutation } from "./useArticleText";

/** Limits of the API (`schemas_kb.py`): a page, not a book. */
const TITLE_MAX = 255;
const BODY_MAX = 100_000;
const SOURCES_MAX = 4000;

const WORD_ACCEPT =
  ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface ArticleEditorProps {
  pageTitle: string;
  initial: ArticleFormValues;
  /** What finishing does: «Отправить на проверку» or «Опубликовать». */
  finishLabel: string;
  /** One line under the page title: what happens after finishing. */
  finishHint: ReactNode;
  /** A note over the form, e.g. «the change returns it from review». */
  notice?: ReactNode;
  /**
   * What the assistant's answer filter found in the saved text — shown while
   * writing, before the text goes to review or to the families.
   */
  warnings?: GuardWarning[];
  busy: boolean;
  error: unknown;
  onSubmit: (values: ArticleFormValues, finish: boolean) => void;
  onCancel: () => void;
}

/**
 * The article editor — one for the clinical and the product articles.
 *
 * A full page and not a side panel: an article is pages of text, and a 30rem
 * panel would make the author scroll a narrow strip. The text is written on
 * the left, «Как увидит семья» stands on the right (under it on a phone) and
 * follows every keystroke.
 *
 * Two buttons, one of them primary (rule П31): finishing — the reason the
 * article is written — is primary; saving a draft is the second. Both stand in
 * the page header, not under the form: on a phone the preview stacks under the
 * text, and a button after it would sit below a second full copy of the
 * article. Enter in the title saves the draft: it never sends a text to review
 * by accident.
 */
export function ArticleEditor({
  pageTitle,
  initial,
  finishLabel,
  finishHint,
  notice,
  warnings = [],
  busy,
  error,
  onSubmit,
  onCancel,
}: ArticleEditorProps) {
  const { t } = useTranslation("articles");
  const ids = useId();
  const [lastAction, setLastAction] = useState<"save" | "finish">("save");

  const schema = z.object({
    title: z
      .string()
      .trim()
      .min(1, t("editor.errors.title"))
      .max(TITLE_MAX, t("editor.errors.titleLong", { max: TITLE_MAX })),
    body_md: z
      .string()
      .trim()
      .min(1, t("editor.errors.body"))
      .max(BODY_MAX, t("editor.errors.bodyLong")),
    sources: z.string().max(SOURCES_MAX, t("editor.errors.sourcesLong")),
    source_file_name: z.string(),
  });

  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    formState: { errors, submitCount },
  } = useForm<ArticleFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  });

  const title = useWatch({ control, name: "title" });
  const body = useWatch({ control, name: "body_md" });

  const convert = useArticleTextMutation();
  const [pendingText, setPendingText] = useState<ArticleText | null>(null);
  const [appliedFile, setAppliedFile] = useState<string | null>(null);

  function applyText(text: ArticleText) {
    const validate = submitCount > 0;
    setValue("body_md", text.body_md, {
      shouldDirty: true,
      shouldValidate: validate,
    });
    if (getValues("title").trim() === "" && text.title) {
      setValue("title", text.title, {
        shouldDirty: true,
        shouldValidate: validate,
      });
    }
    setValue("source_file_name", text.source_file_name, { shouldDirty: true });
    setAppliedFile(text.source_file_name);
  }

  function onFile(file: File | undefined) {
    if (file === undefined) return;
    setAppliedFile(null);
    convert.mutate(file, {
      onSuccess: (text) => {
        // Replacing a typed text silently would lose the author's work; an
        // empty field has nothing to lose.
        if (getValues("body_md").trim() === "") applyText(text);
        else setPendingText(text);
      },
    });
  }

  const titleError = errors.title?.message;
  const bodyError = errors.body_md?.message;
  const sourcesError = errors.sources?.message;

  const save = handleSubmit((values) => {
    setLastAction("save");
    onSubmit(values, false);
  });
  const finish = handleSubmit((values) => {
    setLastAction("finish");
    onSubmit(values, true);
  });

  const disabled = busy || convert.isPending;

  return (
    <PageLayout
      title={pageTitle}
      intro={finishHint}
      width="wide"
      onBack={onCancel}
      backLabel={t("actions.backToList")}
      actions={
        <>
          <Button
            type="button"
            className="min-h-touch"
            disabled={disabled}
            onClick={() => void finish()}
          >
            {busy && lastAction === "finish"
              ? t("actions.saving")
              : finishLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-touch"
            disabled={disabled}
            onClick={() => void save()}
          >
            {busy && lastAction === "save"
              ? t("actions.saving")
              : t("actions.saveDraft")}
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={save} className="flex flex-col gap-section">
        <FormErrorSummary
          items={errorSummaryItems(submitCount, [
            [`${ids}-title`, titleError],
            [`${ids}-body`, bodyError],
            [`${ids}-sources`, sourcesError],
          ])}
          focusKey={submitCount}
        />
        {error !== null && error !== undefined && (
          <FormError>
            {errorMessageOf(error) ?? t("common:errors.unexpected")}
          </FormError>
        )}
        {notice}
        <GuardWarnings warnings={warnings} />

        <Columns
          asideLabel={t("preview.title")}
          asideWidth="wide"
          asideSticky
          main={
            <Section title={t("editor.textTitle")} titleHidden>
              <div className="flex flex-col gap-section">
                <Field
                  id={`${ids}-title`}
                  label={t("editor.title")}
                  error={titleError}
                  {...register("title")}
                />

                <div className="flex flex-col gap-field">
                  <FileField
                    id={`${ids}-word`}
                    label={t("word.label")}
                    hint={t("word.hint")}
                    optional
                    accept={WORD_ACCEPT}
                    disabled={convert.isPending}
                    onChange={(event) => {
                      onFile(event.target.files?.[0]);
                      // The same file chosen again after a fix must convert again.
                      event.target.value = "";
                    }}
                  />
                  {convert.isPending && (
                    <StatusNote className="m-0 text-sm">
                      {t("word.reading")}
                    </StatusNote>
                  )}
                  {appliedFile !== null && !convert.isPending && (
                    <StatusNote className="m-0 text-sm">
                      {t("word.applied", { name: appliedFile })}
                    </StatusNote>
                  )}
                  {convert.isError && (
                    <FormError>
                      {errorMessageOf(convert.error) ??
                        t("common:errors.unexpected")}
                    </FormError>
                  )}
                </div>

                <TextAreaField
                  id={`${ids}-body`}
                  label={t("editor.body")}
                  hint={t("editor.bodyHint")}
                  error={bodyError}
                  rows={18}
                  className="min-h-80 font-mono text-sm"
                  {...register("body_md")}
                />

                <TextAreaField
                  id={`${ids}-sources`}
                  label={t("editor.sources")}
                  hint={t("editor.sourcesHint")}
                  optional
                  error={sourcesError}
                  rows={3}
                  {...register("sources")}
                />
              </div>
            </Section>
          }
          aside={<ArticlePreview title={title} body={body} />}
        />

        <div className="flex flex-wrap items-center gap-field">
          <Button
            type="button"
            variant="ghost"
            className="min-h-touch"
            onClick={onCancel}
          >
            {t("common:actions.cancel")}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={pendingText !== null}
        onOpenChange={(open) => {
          if (!open) setPendingText(null);
        }}
        title={t("word.replaceTitle", {
          name: pendingText?.source_file_name ?? "",
        })}
        description={t("word.replaceDescription")}
        confirmLabel={t("word.replaceConfirm")}
        cancelLabel={t("word.replaceCancel")}
        onConfirm={() => {
          if (pendingText !== null) applyText(pendingText);
          setPendingText(null);
        }}
      />
    </PageLayout>
  );
}
