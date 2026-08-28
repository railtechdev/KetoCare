import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { FormError } from "../../components/FormError";
import { SubmitButton } from "../../components/SubmitButton";
import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { Panel } from "../home/Panel";
import { TextAreaField } from "../../components/Field";
import { formatTimestamp } from "./dates";
import { useCreateClinicalNote } from "./doctorMutations";
import { useClinicalNotes } from "./doctorQueries";
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
    <div className="flex flex-col gap-4">
      <Panel title={t("notes.addTitle")}>
        <form
          noValidate
          onSubmit={handleSubmit((values) =>
            create.mutate(values.text.trim(), {
              onSuccess: () => reset({ text: "" }),
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

          <SubmitButton pending={create.isPending} className="w-auto px-6">
            {t("notes.submit")}
          </SubmitButton>
        </form>
      </Panel>

      <Panel title={t("notes.listTitle")}>
        {notes.isPending && (
          <p role="status" className="m-0 text-muted">
            {t("notes.loading")}
          </p>
        )}

        {forbidden && <p className="m-0 text-muted">{t("notes.forbidden")}</p>}

        {notes.isError && !forbidden && (
          <FormError>
            {errorMessageOf(notes.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        {notes.data !== undefined &&
          (items.length === 0 ? (
            <p className="m-0 text-muted">{t("notes.empty")}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
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
      </Panel>
    </div>
  );
}

function NoteItem({ note, own }: { note: ClinicalNote; own: boolean }) {
  const { t } = useTranslation("doctor");
  const createdAt = formatTimestamp(note.created_at);

  return (
    <article className="rounded-kc border border-line p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">
          {/* Имени автора сервер не отдаёт — только идентификатор, поэтому
              различаются лишь свои и чужие заметки. */}
          {own ? t("notes.authorSelf") : t("notes.authorOther")}
        </span>
        {createdAt !== null && (
          <time
            className="text-sm whitespace-nowrap text-muted tabular-nums"
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
