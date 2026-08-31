import { zodResolver } from "@hookform/resolvers/zod";
import {
  AsyncSection,
  Button,
  EmptyState,
  FormFooter,
  FormSheet,
  Section,
  toast,
} from "@ketocare/ui";
import { Lock, NotebookPen, Plus } from "lucide-react";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { FormError } from "../../components/FormError";
import { TextAreaField } from "../../components/Field";
import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { formatTimestamp } from "./dates";
import { useCreateClinicalNote } from "./doctorMutations";
import { useClinicalNotes, useColleagues } from "./doctorQueries";
import { LinesSkeleton } from "./skeletons";
import type { ClinicalNote } from "./types";

const noteSchema = z.object({ text: z.string().trim().min(1) });

type NoteFormValues = z.infer<typeof noteSchema>;

/**
 * Врачебные заметки (раздел 4.2 ТЗ, `clinical_notes`).
 *
 * Только добавление и чтение: ручек изменения и удаления сервер не даёт
 * намеренно — заметка фиксирует наблюдение на момент времени.
 *
 * Список идёт первым, форма открывается панелью (правило П32 канона): врач
 * приходит сюда читать историю наблюдений, а добавляет запись реже, чем
 * читает. Раскрытая форма над списком отодвигала заметки коллег вниз экрана.
 */
export function NotesTab({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const { session } = useSession();
  const ids = useId();
  const [formOpen, setFormOpen] = useState(false);

  const notes = useClinicalNotes(patientId, true);
  const create = useCreateClinicalNote(patientId);

  // Справочник персонала: заметки подписываются именем, а не «коллегой».
  // Запрашивается всегда, а не по открытию формы: подписи нужны при чтении.
  const colleagues = useColleagues(true);
  const authorNames = Object.fromEntries(
    (colleagues.data ?? []).map((person) => [person.id, person.full_name]),
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NoteFormValues>({
    resolver: zodResolver(noteSchema),
    defaultValues: { text: "" },
  });

  // 403 — не сбой, а граница роли: диетологу заметки не положены. Показывать
  // ему «не удалось загрузить» с кнопкой «Повторить» значило бы предлагать
  // повторять то, что не разрешено.
  const forbidden = errorCodeOf(notes.error) === "forbidden";
  const items = notes.data ?? [];

  function closeForm() {
    setFormOpen(false);
    reset({ text: "" });
  }

  return (
    <>
      <Section
        title={t("notes.listTitle")}
        density="compact"
        action={
          !forbidden && (
            <Button type="button" onClick={() => setFormOpen(true)}>
              <Plus aria-hidden="true" />
              {t("notes.addAction")}
            </Button>
          )
        }
      >
        <AsyncSection
          loading={notes.isLoading}
          skeleton={<LinesSkeleton label={t("notes.loading")} lines={4} />}
          error={
            notes.isError && !forbidden
              ? {
                  title: t("notes.loadError"),
                  description:
                    errorMessageOf(notes.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void notes.refetch()}
          isEmpty={items.length === 0}
          empty={
            forbidden ? (
              <EmptyState
                icon={Lock}
                title={t("notes.forbidden")}
                description={t("notes.forbiddenDescription")}
              />
            ) : (
              <EmptyState
                icon={NotebookPen}
                title={t("notes.empty")}
                description={t("notes.emptyDescription")}
              />
            )
          }
        >
          <ul className="m-0 flex list-none flex-col gap-block p-0">
            {items.map((note) => (
              <li key={note.id}>
                <NoteItem
                  note={note}
                  own={note.author_id === session?.userId}
                  authorName={authorNames[note.author_id]}
                />
              </li>
            ))}
          </ul>
        </AsyncSection>
      </Section>

      <FormSheet
        open={formOpen}
        onOpenChange={(open) => (open ? setFormOpen(true) : closeForm())}
        title={t("notes.addTitle")}
      >
        <form
          noValidate
          className="flex flex-col gap-block"
          onSubmit={handleSubmit((values) =>
            create.mutate(values.text.trim(), {
              onSuccess: () => {
                toast.success(t("notes.added"));
                closeForm();
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
            onCancel={closeForm}
            cancelLabel={t("common:actions.cancel")}
          />
        </form>
      </FormSheet>
    </>
  );
}

function NoteItem({
  note,
  own,
  authorName,
}: {
  note: ClinicalNote;
  own: boolean;
  authorName: string | undefined;
}) {
  const { t } = useTranslation("doctor");
  const createdAt = formatTimestamp(note.created_at);

  return (
    <article className="rounded-xl border border-border p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-block">
        <span className="text-sm font-semibold">
          {/* Имя коллеги берётся из справочника персонала: «Заметка коллеги»
              не отвечает на вопрос, с кем сверяться — а заметку в карте
              пишут именно для того, чтобы следующий специалист знал, кто и что
              решил. Справочника может не быть под рукой (он грузится отдельно)
              — тогда остаётся прежняя безличная подпись. */}
          {own ? t("notes.authorSelf") : (authorName ?? t("notes.authorOther"))}
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
