import {
  AsyncSection,
  Button,
  ConfirmDialog,
  EmptyState,
  FormFooter,
  FormSheet,
  Section,
  toast,
} from "@ketocare/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Image, Paperclip, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { FileField, SelectField, Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { api, errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { formatIsoDate } from "../doctor/dates";
import { LinesSkeleton } from "../doctor/skeletons";
import type { Attachment } from "../doctor/types";
import { queryState } from "../../lib/queryState";

/** Виды документов — как в справочнике сервера (`AttachmentDocKind`). */
const DOC_KINDS = [
  "discharge",
  "eeg",
  "imaging",
  "lab",
  "prescription",
  "other",
] as const;

function attachmentsKey(patientId: string) {
  return ["patient", patientId, "attachments"] as const;
}

/**
 * Документы пациента: выписки, ЭЭГ, анализы, бумажные назначения.
 *
 * До этого прикрепить их было некуда: решение о кетотерапии и её коррекции
 * опирается на документы, которые семья приносит из стационара, и им в продукте
 * не было места (ADR-0004).
 *
 * Удалить может только тот, кто загрузил (решение заказчика, ADR-0013): родитель
 * убирает свою ошибку, врач — свою. Кнопка у чужого документа не показывается —
 * она вела бы в заведомый 403 (правило П3 канона).
 *
 * Панель общая для семьи и специалиста, поэтому лежит не в `features/doctor`:
 * документы приносит из стационара именно семья, и экран, доступный только
 * врачу, оставлял бы её без способа их приложить — при том что ради этого
 * подсистема и делалась.
 */
export function AttachmentsPanel({ patientId }: { patientId: string }) {
  const { t } = useTranslation("attachments");
  const ids = useId();
  const queryClient = useQueryClient();
  const { session } = useSession();

  const [formOpen, setFormOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [docKind, setDocKind] = useState("");
  const [docDate, setDocDate] = useState("");
  const [description, setDescription] = useState("");

  function resetForm() {
    setFile(null);
    setDocKind("");
    setDocDate("");
    setDescription("");
  }

  const attachments = useQuery({
    queryKey: attachmentsKey(patientId),
    queryFn: async (): Promise<Attachment[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/attachments",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data)
        throw error ?? new Error("Empty attachments response");
      return data;
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: attachmentsKey(patientId) });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      // Пустые поля не отправляются: сервер отличает «не указано» от пустой
      // строки, и пустая дата упала бы разбором.
      if (docKind) form.append("doc_kind", docKind);
      if (docDate) form.append("doc_date", docDate);
      if (description.trim()) form.append("description", description.trim());

      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/attachments",
        {
          params: { path: { patient_id: patientId } },
          body: form as unknown as { file: string },
          bodySerializer: (body: unknown) => body as FormData,
        },
      );
      if (error || !data) throw error ?? new Error("Empty upload response");
      return data;
    },
    onSuccess: async () => {
      resetForm();
      setFormOpen(false);
      toast.success(t("uploaded"));
      await invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: async (attachmentId: string) => {
      const { error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/attachments/{attachment_id}",
        {
          params: {
            path: { patient_id: patientId, attachment_id: attachmentId },
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success(t("removed"));
      await invalidate();
    },
  });

  const items = attachments.data ?? [];

  return (
    <Section
      title={t("title")}
      description={t("intro")}
      // Список идёт раньше формы (правило П32): сюда приходят смотреть
      // документы, а добавляют изредка. Форма была раскрыта под списком
      // всегда и отправляла файл сразу при выборе — без «Загрузить», то есть
      // без шанса проверить вид и дату (П9).
      action={
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            upload.reset();
            setFormOpen(true);
          }}
        >
          <Plus aria-hidden="true" />
          {t("add")}
        </Button>
      }
    >
      <AsyncSection
        {...queryState(attachments)}
        skeleton={<LinesSkeleton label={t("loading")} lines={3} />}
        error={
          attachments.isError
            ? {
                title: t("loadError"),
                description:
                  errorMessageOf(attachments.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void attachments.refetch()}
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={Paperclip}
            title={t("empty")}
            description={t("emptyDescription")}
          />
        }
      >
        <ul className="m-0 flex list-none flex-col gap-field p-0">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-field rounded-lg border border-border px-3 py-2"
            >
              {item.mime === "application/pdf" ? (
                <FileText aria-hidden="true" className="size-4 shrink-0" />
              ) : (
                <Image aria-hidden="true" className="size-4 shrink-0" />
              )}

              {/* Имя — ссылка на файл: скачивание идёт по обычной ссылке,
                  браузер приложит httpOnly-куку сам (раздел 5.2 ТЗ). */}
              <a
                href={`/api/v1/patients/${patientId}/attachments/${item.id}/file`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 break-words underline-offset-2 hover:underline"
              >
                {item.description || item.filename}
              </a>

              {item.doc_kind !== null && (
                <span className="text-sm text-muted-foreground">
                  {t(`kinds.${item.doc_kind}`)}
                </span>
              )}
              {item.doc_date !== null && (
                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatIsoDate(item.doc_date)}
                </span>
              )}

              {/* Своё убирает загрузивший, любое — ведущий специалист
                  (аудит блокеров, C7): иначе документ ушедшего взрослого
                  оставался в карте навсегда. Правило — то же, что на сервере. */}
              {(item.uploaded_by === session?.userId ||
                session?.role === "doctor" ||
                session?.role === "dietitian") && (
                <ConfirmDialog
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-touch text-destructive"
                      aria-label={t("removeAria", { name: item.filename })}
                    >
                      <Trash2 aria-hidden="true" />
                      {t("remove")}
                    </Button>
                  }
                  title={t("confirmRemoveTitle", { name: item.filename })}
                  description={t("confirmRemoveBody")}
                  confirmLabel={t("confirmRemoveAction")}
                  cancelLabel={t("common:actions.cancel")}
                  onConfirm={() => remove.mutate(item.id)}
                />
              )}
            </li>
          ))}
        </ul>
      </AsyncSection>

      {remove.isError && (
        <FormError>
          {errorMessageOf(remove.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      <FormSheet
        closeLabel={t("common:actions.close")}
        open={formOpen}
        onOpenChange={(open) => {
          // Закрытие во время отправки не теряет файл: панель вернётся с ним.
          if (!open && !upload.isPending) resetForm();
          setFormOpen(open);
        }}
        title={t("form.title")}
        description={t("intro")}
      >
        <form
          noValidate
          className="flex flex-col gap-field"
          onSubmit={(event) => {
            event.preventDefault();
            if (file !== null) upload.mutate(file);
          }}
        >
          <FileField
            id={`${ids}-file`}
            width="wide"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            label={t("form.file")}
            hint={t("form.fileHint")}
            disabled={upload.isPending}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />

          <SelectField
            id={`${ids}-kind`}
            width="medium"
            optional
            label={t("form.kind")}
            value={docKind}
            onChange={(event) => setDocKind(event.target.value)}
          >
            <option value="">{t("form.kindNotSet")}</option>
            {DOC_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </option>
            ))}
          </SelectField>

          <Field
            id={`${ids}-date`}
            type="date"
            width="date"
            optional
            label={t("form.date")}
            hint={t("form.dateHint")}
            value={docDate}
            onChange={(event) => setDocDate(event.target.value)}
          />

          <Field
            id={`${ids}-description`}
            width="wide"
            optional
            maxLength={255}
            label={t("form.description")}
            hint={t("form.descriptionHint")}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />

          {upload.isError && (
            <FormError>
              {errorMessageOf(upload.error) ?? t("common:errors.unexpected")}
            </FormError>
          )}

          <FormFooter
            submitLabel={t("form.submit")}
            pendingLabel={t("uploading")}
            pending={upload.isPending}
            disabled={file === null}
            reason={t("form.noFile")}
            onCancel={() => {
              resetForm();
              setFormOpen(false);
            }}
            cancelLabel={t("common:actions.cancel")}
          />
        </form>
      </FormSheet>
    </Section>
  );
}
