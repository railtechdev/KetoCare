import {
  AsyncSection,
  Button,
  ConfirmDialog,
  EmptyState,
  Section,
  toast,
} from "@ketocare/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Image, Paperclip, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { FileField, SelectField, Field } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { api, errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { formatIsoDate } from "./dates";
import { LinesSkeleton } from "./skeletons";
import type { Attachment } from "./types";

/** Виды документов — как в справочнике сервера (`AttachmentDocKind`). */
const DOC_KINDS = ["discharge", "eeg", "lab", "prescription", "other"] as const;

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
 */
export function AttachmentsPanel({ patientId }: { patientId: string }) {
  const { t } = useTranslation("attachments");
  const ids = useId();
  const queryClient = useQueryClient();
  const { session } = useSession();

  const [docKind, setDocKind] = useState("");
  const [docDate, setDocDate] = useState("");
  const [description, setDescription] = useState("");

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
      setDocKind("");
      setDocDate("");
      setDescription("");
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
    <Section title={t("title")} description={t("intro")} density="compact">
      <AsyncSection
        loading={attachments.isPending}
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

              {item.uploaded_by === session?.userId && (
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

      <div className="flex flex-col gap-field border-t border-border pt-block">
        <div className="flex flex-wrap gap-block">
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
        </div>

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

        {/* Файл — последним: описание заполняется до выбора, потому что выбор
            сразу отправляет форму. Обратный порядок означал бы, что заполненные
            поля не попадут в загрузку (правило П32 канона — сначала контекст). */}
        <FileField
          id={`${ids}-file`}
          width="wide"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          label={t("form.file")}
          hint={t("form.fileHint")}
          disabled={upload.isPending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            upload.mutate(file);
            // Сброс: иначе повторный выбор того же файла не вызовет `change`.
            event.target.value = "";
          }}
        />

        {upload.isPending && (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {t("uploading")}
          </p>
        )}

        {upload.isError && (
          <FormError>
            {errorMessageOf(upload.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}
      </div>
    </Section>
  );
}
