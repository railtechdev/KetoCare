import {
  AsyncSection,
  Button,
  ConfirmDialog,
  EmptyState,
  FormFooter,
  Section,
  Skeleton,
  WarningBanner,
  cn,
  toast,
} from "@ketocare/ui";
import { OctagonX, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { TextAreaField } from "../../components/Field";
import { errorMessageOf } from "../../lib/api";
import { formatIsoDate, formatTimestamp } from "../doctor/dates";
import {
  approvalRejectionOf,
  useApproveSummaryMutation,
  useDoctorSummaries,
  useRequestSummaryMutation,
  type ApprovalRejection,
  type DoctorSummary,
  type SummaryCheck,
} from "./useDoctorSummary";
import type { ReportRange } from "./useReports";
import { queryState } from "../../lib/queryState";

type ApproveMutation = ReturnType<typeof useApproveSummaryMutation>;

/**
 * Черновик сводки и его утверждение (раздел 10.5 ТЗ, п. 21 этапа 4).
 *
 * Живёт внутри вкладки «Отчёт» карты пациента, а не седьмой вкладкой и не
 * разделом меню: вкладок уже шесть, это потолок канона (правило П29), а период
 * у сводки и у отчёта обязан быть один. Отдельный выбор дат позволил бы
 * утвердить сводку за август, глядя на числа за сентябрь.
 *
 * Пометка «Черновик ИИ — требует проверки врача» прикреплена к тексту, а не к
 * экрану: баннер стоит непосредственно над черновиком и остаётся над полем при
 * правке. Отделить её прокруткой нельзя, и она не исчезает в тот момент, когда
 * врач начинает работать с текстом.
 *
 * Главная гарантия при этом не здесь: черновик физически не попадает ни в
 * отчёт, ни в PDF, ни в выгрузку — фильтр `approved_md is not null` стоит в
 * единственном месте выборки на сервере, и экран его обойти не может.
 */
export function DoctorSummaryPanel({
  patientId,
  range,
  disabled,
}: {
  patientId: string;
  range: ReportRange;
  disabled: boolean;
}) {
  const { t } = useTranslation("reports");
  const summaries = useDoctorSummaries(patientId, range, !disabled);
  const request = useRequestSummaryMutation(patientId, range);
  const approve = useApproveSummaryMutation(patientId, range);

  const latest = summaries.data?.[0] ?? null;
  const pending = latest?.status === "queued" || latest?.status === "running";

  return (
    <Section
      title={t("summary.title")}
      level={2}
      density="compact"
      description={t("summary.description")}
      action={
        <Button
          type="button"
          variant={latest ? "outline" : "default"}
          className="min-h-touch"
          disabled={disabled || pending || request.isPending}
          aria-busy={pending || undefined}
          onClick={() =>
            request.mutate(undefined, {
              onError: (error) =>
                toast.error(
                  errorMessageOf(error) ?? t("common:errors.unexpected"),
                ),
            })
          }
        >
          <Sparkles aria-hidden="true" />
          {latest ? t("summary.again") : t("summary.request")}
        </Button>
      }
    >
      <AsyncSection
        {...queryState(summaries)}
        skeleton={<Skeleton className="h-24 w-full rounded-xl" />}
        error={summaries.isError ? { title: t("summary.loadFailed") } : null}
        retryLabel={t("common:actions.retry")}
        onRetry={() => void summaries.refetch()}
        isEmpty={latest === null}
        empty={
          <EmptyState
            title={t("summary.empty.title")}
            description={t("summary.empty.description")}
          />
        }
      >
        {latest && <SummaryState summary={latest} approve={approve} />}
      </AsyncSection>
    </Section>
  );
}

function SummaryState({
  summary,
  approve,
}: {
  summary: DoctorSummary;
  approve: ApproveMutation;
}) {
  const { t } = useTranslation("reports");

  if (summary.status === "queued" || summary.status === "running") {
    return (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        {t("summary.building")}
      </p>
    );
  }

  if (summary.status === "failed" || summary.draft_md === null) {
    /* У отказа обязано быть действие (правило П16 канона), и оно уже есть —
       кнопка «Собрать заново» в шапке блока. */
    return (
      <p className="m-0 text-sm text-destructive">
        {summary.error ?? t("summary.failed")}
      </p>
    );
  }

  return <Draft summary={summary} approve={approve} />;
}

function Draft({
  summary,
  approve,
}: {
  summary: DoctorSummary;
  approve: ApproveMutation;
}) {
  const { t } = useTranslation("reports");
  const approved = summary.approved_md !== null;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmingAnyway, setConfirmingAnyway] = useState(false);
  // Отказ постфильтра относится к присланному тексту: правка его снимает, иначе
  // под новым текстом висели бы находки старого.
  const [rejection, setRejection] = useState<ApprovalRejection | null>(null);
  const [text, setText] = useState(
    summary.approved_md ?? summary.draft_md ?? "",
  );

  // Черновик мог смениться, пока экран открыт: собрали заново, и в поле должен
  // оказаться новый текст, а не тот, что врач видел до этого.
  useEffect(() => {
    setText(summary.approved_md ?? summary.draft_md ?? "");
    setEditing(false);
    setRejection(null);
  }, [summary.id, summary.draft_md, summary.approved_md]);

  const noticeId = `summary-notice-${summary.id}`;

  /**
   * Утверждение. Постфильтр стоит против выдумок модели, а не против врача
   * (дополнение к ADR-0023): находка в предложении черновика, оставленном как
   * есть, запрещает утверждение, а находка в словах самого врача приходит
   * предупреждением — и врач утверждает повторно, уже с подтверждением.
   */
  function submit(acknowledged = false) {
    approve.mutate(
      { summaryId: summary.id, approvedMd: text, acknowledged },
      {
        onSuccess: () => {
          setEditing(false);
          setRejection(null);
          toast.success(t("summary.approved"));
        },
        onError: (error) => {
          const rejected = approvalRejectionOf(error);
          if (rejected) {
            setRejection(rejected);
            return;
          }
          toast.error(errorMessageOf(error) ?? t("common:errors.unexpected"));
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-section">
      {!approved && (
        /* Формулировка — дословно из раздела 10.5 ТЗ. Не переписывать: это
           согласованный продуктовый текст, и он же единственное, что стоит
           между текстом модели и клиническим документом. */
        <WarningBanner id={noticeId} level="warning">
          {t("summary.notice")}
        </WarningBanner>
      )}

      {approved && summary.approved_at && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("summary.approvedAt", {
            at: formatTimestamp(summary.approved_at) ?? summary.approved_at,
          })}
        </p>
      )}

      {editing ? (
        <form
          className="flex flex-col gap-section"
          onSubmit={(event) => {
            event.preventDefault();
            setConfirming(true);
          }}
        >
          <TextAreaField
            id={`summary-text-${summary.id}`}
            label={t("summary.textLabel")}
            rows={18}
            value={text}
            aria-describedby={approved ? undefined : noticeId}
            onChange={(event) => {
              setText(event.target.value);
              setRejection(null);
            }}
          />
          {rejection && (
            <Rejection
              rejection={rejection}
              pending={approve.isPending}
              onApproveAnyway={() => setConfirmingAnyway(true)}
            />
          )}
          <FormFooter
            submitLabel={t("summary.approve")}
            pendingLabel={t("summary.approving")}
            pending={approve.isPending}
            cancelLabel={t("common:actions.cancel")}
            onCancel={() => setEditing(false)}
          />
          {/* Управляемый режим: подтверждение открывает не кнопка, а отправка
              формы. Это момент, в который машинный текст становится
              клиническими данными (правило 6 CLAUDE.md), и он должен быть
              отдельным осознанным действием, а не побочным следствием правки. */}
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={t("summary.confirm.title", {
              from: formatIsoDate(summary.period_start) ?? summary.period_start,
              to: formatIsoDate(summary.period_end) ?? summary.period_end,
            })}
            description={t("summary.confirm.description")}
            confirmLabel={t("summary.approve")}
            cancelLabel={t("common:actions.cancel")}
            destructive={false}
            onConfirm={() => submit()}
          />
          {/* Второе подтверждение — отдельное: врач соглашается не с текстом
              вообще, а с тем, что отмеченные фразы его, и это попадает в
              журнал аудита. */}
          <ConfirmDialog
            open={confirmingAnyway}
            onOpenChange={setConfirmingAnyway}
            title={t("summary.rejected.confirmTitle")}
            description={t("summary.rejected.confirmDescription")}
            confirmLabel={t("summary.rejected.anyway")}
            cancelLabel={t("common:actions.cancel")}
            destructive={false}
            onConfirm={() => submit(true)}
          />
        </form>
      ) : (
        <>
          <p
            className={
              approved
                ? "m-0 whitespace-pre-line border-l-4 border-l-success pl-section text-sm"
                : "m-0 whitespace-pre-line border-l-4 border-l-warning pl-section text-sm"
            }
            aria-describedby={approved ? undefined : noticeId}
          >
            {summary.approved_md ?? summary.draft_md}
          </p>
          <Button
            type="button"
            variant={approved ? "outline" : "default"}
            className="min-h-touch self-start"
            onClick={() => setEditing(true)}
          >
            {approved ? t("summary.edit") : t("summary.review")}
          </Button>
        </>
      )}

      {!approved && summary.checks.length > 0 && (
        <Checks checks={summary.checks} />
      )}
    </div>
  );
}

/**
 * Отказ утверждения: что именно не прошло и можно ли утвердить как есть.
 *
 * Два случая и два разных ответа. Предложение черновика модели, оставленное
 * без изменений, утвердить нельзя ничем — кнопки нет, есть объяснение. Если
 * все находки в словах самого врача, это предупреждение, и рядом с ним стоит
 * «Утвердить всё равно» (через подтверждение).
 */
function Rejection({
  rejection,
  pending,
  onApproveAnyway,
}: {
  rejection: ApprovalRejection;
  pending: boolean;
  onApproveAnyway: () => void;
}) {
  const { t } = useTranslation("reports");
  const { acknowledgeable } = rejection;

  return (
    <WarningBanner
      level={acknowledgeable ? "warning" : "danger"}
      title={
        acknowledgeable
          ? t("summary.rejected.warningTitle")
          : t("summary.rejected.title")
      }
    >
      <div className="flex flex-col gap-field">
        <p className="m-0">
          {acknowledgeable
            ? t("summary.rejected.warning")
            : t("summary.rejected.blocking")}
        </p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {rejection.findings.map((finding, index) => (
            <li key={`${finding.kind}-${index}`} className="text-sm">
              <span className="font-medium">
                {t(`summary.checks.kind.${finding.kind}`, {
                  defaultValue: t("summary.checks.kind.other"),
                })}
              </span>
              {finding.origin !== "guard" && (
                <span className="text-muted-foreground">
                  {" "}
                  (
                  {finding.origin === "doctor"
                    ? t("summary.rejected.fromDoctor")
                    : t("summary.rejected.fromDraft")}
                  )
                </span>
              )}
              {finding.fragment && (
                <span className="text-muted-foreground">
                  {" "}
                  — «{finding.fragment}»
                </span>
              )}
            </li>
          ))}
        </ul>
        {acknowledgeable && (
          <Button
            type="button"
            variant="outline"
            className="min-h-touch self-start"
            disabled={pending}
            onClick={onApproveAnyway}
          >
            {t("summary.rejected.anyway")}
          </Button>
        )}
      </div>
    </WarningBanner>
  );
}

/**
 * Что нашёл постфильтр.
 *
 * Показывается вместе с текстом, а не вместо него: врач должен отличать
 * «модель написала лишнее» от «система сломалась». Класс находки приходит с
 * сервера кодом, формулировка живёт здесь — её можно согласовать с медицинской
 * командой, не трогая бэкенд (правило 8 CLAUDE.md).
 */
function Checks({ checks }: { checks: SummaryCheck[] }) {
  const { t } = useTranslation("reports");

  return (
    <div className="flex flex-col gap-field">
      <p className="m-0 text-sm font-medium">{t("summary.checks.title")}</p>
      <ul className="m-0 flex list-none flex-col gap-field p-0">
        {checks.map((check, index) => (
          <li
            key={`${check.kind}-${index}`}
            className="flex flex-wrap items-baseline gap-x-1 text-sm"
          >
            {/* Запрещающая находка отличается от подсказки значком и словом,
                а не только цветом (WCAG 1.4.1): от этого различия зависит,
                можно ли утвердить сводку. */}
            <span
              className={cn(
                "inline-flex items-center gap-1 self-center",
                check.hard ? "text-destructive" : "text-warning-strong",
              )}
            >
              {check.hard ? (
                <OctagonX aria-hidden="true" className="size-4 shrink-0" />
              ) : (
                <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
              )}
              {t(`summary.checks.kind.${check.kind}`, {
                defaultValue: t("summary.checks.kind.other"),
              })}
            </span>
            <span className="text-muted-foreground">
              (
              {check.hard
                ? t("summary.checks.hardMark")
                : t("summary.checks.softMark")}
              )
            </span>
            {check.fragment && (
              <span className="text-muted-foreground">
                {" "}
                — «{check.fragment}»
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="m-0 text-sm text-muted-foreground">
        {checks.some((check) => check.hard)
          ? t("summary.checks.hard")
          : t("summary.checks.soft")}
      </p>
    </div>
  );
}
