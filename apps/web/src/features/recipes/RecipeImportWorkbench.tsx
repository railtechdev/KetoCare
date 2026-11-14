import {
  ActionReason,
  AsyncSection,
  Button,
  ConfirmDialog,
  Progress,
  Section,
  Skeleton,
  WarningBanner,
} from "@ketocare/ui";
import { FileUp } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { FileField, TextAreaField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { queryState } from "../../lib/queryState";
import { ImportNames } from "./ImportNames";
import { ImportRecipes } from "./ImportRecipes";
import {
  useCloseImport,
  useImportDraft,
  useImportDrafts,
  useResumeImport,
  useStartImport,
  type ImportDraft,
  type ImportDraftSummary,
} from "./useRecipeImportDraft";

/**
 * Загрузка рецептов из файла диетолога как он есть (ADR-0079).
 *
 * Прежний импорт принимал только таблицу по нашему шаблону и отвечал списком
 * ошибок. Человек с готовым сборником в Word упирался в него и уходил вводить
 * рецепты по одному. Здесь файл принимается любым, а всё, чего он не объяснил
 * сам, — незнакомый продукт, строка без массы — становится строкой таблицы с
 * действием, на этом же экране.
 *
 * Какая загрузка открыта, живёт в адресе (`?item=import:<id>`): большой
 * сборник разбирают в несколько подходов, и F5 или «Назад» не должны терять
 * место.
 */
export function RecipeImportWorkbench({
  draftId,
  onOpenDraft,
  onOpenRecipe,
  onTemplate,
  onDone,
}: {
  /** Открытая загрузка; без неё — экран выбора файла. */
  draftId: string | null;
  onOpenDraft: (draftId: string | null) => void;
  onOpenRecipe: (recipeId: string) => void;
  /** Прежний импорт таблицы по шаблону: он работает и без разбора. */
  onTemplate: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation("recipes");

  return (
    <PageLayout
      title={t("importDraft.title")}
      intro={draftId === null ? t("importDraft.intro") : undefined}
      width="wide"
      onBack={draftId === null ? onDone : () => onOpenDraft(null)}
    >
      {draftId === null ? (
        <UploadStep onOpenDraft={onOpenDraft} onTemplate={onTemplate} />
      ) : (
        <Review draftId={draftId} onOpenRecipe={onOpenRecipe} />
      )}
    </PageLayout>
  );
}

function UploadStep({
  onOpenDraft,
  onTemplate,
}: {
  onOpenDraft: (draftId: string) => void;
  onTemplate: () => void;
}) {
  const { t } = useTranslation("recipes");
  const ids = useId();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const start = useStartImport();
  const nothing = file === null && text.trim() === "";

  return (
    <div className="flex flex-col gap-section">
      <Section title={t("importDraft.upload.howTitle")}>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>{t("importDraft.upload.how1")}</li>
          <li>{t("importDraft.upload.how2")}</li>
          <li>{t("importDraft.upload.how3")}</li>
        </ul>
      </Section>

      <div className="flex flex-col gap-field">
        <FileField
          id={`${ids}-file`}
          width="wide"
          accept=".docx,.xlsx,.csv,.txt,.md,text/plain,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          label={t("importDraft.upload.file")}
          hint={t("importDraft.upload.fileHint")}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            start.reset();
          }}
        />
        <TextAreaField
          id={`${ids}-text`}
          label={t("importDraft.upload.text")}
          hint={t("importDraft.upload.textHint")}
          rows={6}
          value={text}
          // Файл выбран — он и уходит: два источника разом сервер не читает.
          disabled={file !== null}
          onChange={(event) => {
            setText(event.target.value);
            start.reset();
          }}
        />
      </div>

      <div className="flex flex-col items-start gap-field">
        <Button
          type="button"
          disabled={nothing || start.isPending}
          aria-busy={start.isPending}
          aria-describedby={`${ids}-start-reason`}
          onClick={() =>
            start.mutate(file !== null ? { file } : { text }, {
              onSuccess: (draft) => onOpenDraft(draft.id),
            })
          }
        >
          <FileUp aria-hidden="true" />
          {start.isPending
            ? t("importDraft.upload.starting")
            : t("importDraft.upload.start")}
        </Button>
        <ActionReason id={`${ids}-start-reason`}>
          {nothing ? t("importDraft.upload.nothing") : null}
        </ActionReason>
        {/* Отказ называет выход: «сохраните как .docx», «вставьте текст». */}
        {start.isError && (
          <FormError>
            {errorMessageOf(start.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}
        <Button type="button" variant="link" onClick={onTemplate}>
          {t("importDraft.upload.template")}
        </Button>
      </div>

      <OpenDrafts onOpenDraft={onOpenDraft} />
    </div>
  );
}

/** Начатые загрузки: вернуться к сборнику, разобранному наполовину. */
function OpenDrafts({
  onOpenDraft,
}: {
  onOpenDraft: (draftId: string) => void;
}) {
  const { t } = useTranslation("recipes");
  const drafts = useImportDrafts();
  const close = useCloseImport();
  const [removing, setRemoving] = useState<ImportDraftSummary | null>(null);

  if (!drafts.data || drafts.data.length === 0) return null;

  return (
    <Section title={t("importDraft.drafts.title")}>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {drafts.data.map((draft) => (
          <li
            key={draft.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-2 last:border-b-0"
          >
            <span className="min-w-0 flex-1 basis-48 font-medium">
              {draft.file_name}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {draft.status === "parsing"
                ? t("importDraft.drafts.parsing")
                : t("importDraft.drafts.progress", {
                    imported: draft.imported,
                    recipes: draft.recipes,
                  })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenDraft(draft.id)}
            >
              {t("importDraft.drafts.open")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRemoving(draft)}
            >
              {t("importDraft.drafts.remove")}
            </Button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("importDraft.drafts.confirmRemove.title", {
          name: removing?.file_name ?? "",
        })}
        description={t("importDraft.drafts.confirmRemove.body")}
        confirmLabel={t("importDraft.drafts.confirmRemove.confirm")}
        cancelLabel={t("actions.cancel")}
        onConfirm={() => {
          if (removing !== null) {
            close.mutate(removing.id, { onSettled: () => setRemoving(null) });
          }
        }}
      />
    </Section>
  );
}

function Review({
  draftId,
  onOpenRecipe,
}: {
  draftId: string;
  onOpenRecipe: (recipeId: string) => void;
}) {
  const { t } = useTranslation("recipes");
  const draft = useImportDraft(draftId);

  return (
    <AsyncSection
      {...queryState(draft)}
      skeleton={<Skeleton className="h-40 w-full" />}
      error={
        draft.isError
          ? {
              title: t("common:errors.unexpected"),
              description: errorMessageOf(draft.error) ?? undefined,
            }
          : null
      }
      retryLabel={t("common:actions.retry")}
      onRetry={() => void draft.refetch()}
      isEmpty={draft.data === undefined}
      empty={null}
    >
      {draft.data !== undefined && (
        <div className="flex flex-col gap-section">
          <ReadingStatus draft={draft.data} />
          <ImportNames draft={draft.data} />
          <ImportRecipes draft={draft.data} onOpenRecipe={onOpenRecipe} />
        </div>
      )}
    </AsyncSection>
  );
}

/** Как идёт чтение файла — и что делать, если оно остановилось. */
function ReadingStatus({ draft }: { draft: ImportDraft }) {
  const { t } = useTranslation("recipes");
  const resume = useResumeImport(draft.id);
  const position = { done: draft.lines_done, total: draft.lines_total };
  const unfinished = draft.lines_done < draft.lines_total;

  const resumeButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={resume.isPending}
      aria-busy={resume.isPending}
      onClick={() => resume.mutate()}
    >
      {resume.isPending
        ? t("importDraft.status.resuming")
        : t("importDraft.status.resume")}
    </Button>
  );

  return (
    <>
      <p className="m-0 font-medium">{draft.file_name}</p>

      {draft.status === "parsing" && !draft.stalled && (
        <div className="flex flex-col gap-2" role="status">
          <p className="m-0 text-sm tabular-nums">
            {t("importDraft.status.parsing", position)}
          </p>
          <Progress
            value={
              draft.lines_total === 0
                ? 0
                : (draft.lines_done / draft.lines_total) * 100
            }
            aria-label={t("importDraft.status.parsing", position)}
          />
        </div>
      )}

      {draft.status === "parsing" && draft.stalled && (
        <WarningBanner level="warning">
          <p className="m-0 tabular-nums">
            {t("importDraft.status.stalled", position)}
          </p>
          {resumeButton}
        </WarningBanner>
      )}

      {draft.status === "failed" && (
        <WarningBanner
          level="warning"
          title={t("importDraft.status.failedTitle")}
        >
          {draft.failure && <p className="m-0">{draft.failure}</p>}
          <p className="m-0 tabular-nums">
            {t("importDraft.status.failed", position)}
          </p>
          {unfinished && resumeButton}
        </WarningBanner>
      )}

      {resume.isError && (
        <FormError>
          {errorMessageOf(resume.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {draft.notes.length > 0 && (
        <WarningBanner level="info" title={t("importDraft.status.notesTitle")}>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
            {draft.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </WarningBanner>
      )}
    </>
  );
}
