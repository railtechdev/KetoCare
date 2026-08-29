import { zodResolver } from "@hookform/resolvers/zod";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  FormFooter,
  toast,
} from "@ketocare/ui";
import { Lock, NotebookPen } from "lucide-react";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { FormError } from "../../components/FormError";
import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { TextAreaField } from "../../components/Field";
import { formatTimestamp } from "./dates";
import { useCreateClinicalNote } from "./doctorMutations";
import { useClinicalNotes } from "./doctorQueries";
import { LinesSkeleton } from "./skeletons";
import type { ClinicalNote } from "./types";

const noteSchema = z.object({ text: z.string().trim().min(1) });

type NoteFormValues = z.infer<typeof noteSchema>;

/**
 * Врачебные заметки (раздел 4.2 ТЗ, `clinical_notes`).
 *
 * Только добавление и чтение: ручек изменения и удаления сервер не даёт
 * намеренно — заметка фиксирует наблюдение на момент времени.
 */
export function NotesTab({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const { session } = useSession();
  const ids = useId();

  const notes = useClinicalNotes(patientId, true);
  const create = useCreateClinicalNote(patientId);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NoteFormValues>({
    resolver: zodResolver(noteSchema),
    defaultValues: { text: "" },
  });

  const forbidden = errorCodeOf(notes.error) === "forbidden";
  const items = notes.data ?? [];

  return (
    <div className="flex flex-col gap-block">
      <Card>
        <CardHeader>
          <CardTitle className="text-card-title">
            {t("notes.addTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            className="flex flex-col gap-block"
            onSubmit={handleSubmit((values) =>
              create.mutate(values.text.trim(), {
                onSuccess: () => {
                  toast.success(t("notes.added"));
                  reset({ text: "" });
                },
              }),
            )}
          >
            <TextAreaField
              id={`${ids}-note`}
              rows={5}
              label={t("notes.text")}
              placeholder={t("notes.placeholder")}
              error={errors.text && t("notes.errors.text")}
              {...register("text")}
            />

            {create.isError && (
              <FormError>
                {errorMessageOf(create.error) ?? t("common:errors.unexpected")}
              </FormError>
            )}

            <FormFooter
              submitLabel={t("notes.submit")}
              pendingLabel={t("notes.submitPending")}
              pending={create.isPending}
            />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-card-title">
            {t("notes.listTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {notes.isPending && (
            <LinesSkeleton label={t("notes.loading")} lines={4} />
          )}

          {forbidden && (
            <EmptyState
              icon={Lock}
              title={t("notes.forbidden")}
              description={t("notes.forbiddenDescription")}
            />
          )}

          {notes.isError && !forbidden && (
            <ErrorState
              title={t("notes.loadError")}
              description={
                errorMessageOf(notes.error) ?? t("common:errors.unexpected")
              }
              retryLabel={t("common:actions.retry")}
              onRetry={() => void notes.refetch()}
            />
          )}

          {notes.data !== undefined &&
            (items.length === 0 ? (
              <EmptyState
                icon={NotebookPen}
                title={t("notes.empty")}
                description={t("notes.emptyDescription")}
              />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-block p-0">
                {items.map((note) => (
                  <li key={note.id}>
                    <NoteItem
                      note={note}
                      own={note.author_id === session?.userId}
                    />
                  </li>
                ))}
              </ul>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}

function NoteItem({ note, own }: { note: ClinicalNote; own: boolean }) {
  const { t } = useTranslation("doctor");
  const createdAt = formatTimestamp(note.created_at);

  return (
    <article className="rounded-xl border border-border p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-block">
        <span className="text-sm font-semibold">
          {/* Имени автора сервер не отдаёт — только идентификатор, поэтому
              различаются лишь свои и чужие заметки. */}
          {own ? t("notes.authorSelf") : t("notes.authorOther")}
        </span>
        {createdAt !== null && (
          <time
            className="text-sm whitespace-nowrap text-muted-foreground tabular-nums"
            dateTime={note.created_at}
          >
            {createdAt}
          </time>
        )}
      </header>
      <p className="m-0 mt-2 whitespace-pre-line">{note.text}</p>
    </article>
  );
}
