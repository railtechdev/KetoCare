import {
  AsyncSection,
  Button,
  ConfirmDialog,
  EmptyState,
  FormFooter,
  Section,
  Skeleton,
  WarningBanner,
  toast,
} from "@ketocare/ui";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { TextAreaField } from "../../components/Field";
import { errorMessageOf } from "../../lib/api";
import {
  useApproveSummaryMutation,
  useDoctorSummaries,
  useRequestSummaryMutation,
  type DoctorSummary,
  type SummaryCheck,
} from "./useDoctorSummary";
import type { ReportRange } from "./useReports";

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
        loading={summaries.isLoading}
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
  const [text, setText] = useState(
    summary.approved_md ?? summary.draft_md ?? "",
  );

  // Черновик мог смениться, пока экран открыт: собрали заново, и в поле должен
  // оказаться новый текст, а не тот, что врач видел до этого.
  useEffect(() => {
    setText(summary.approved_md ?? summary.draft_md ?? "");
    setEditing(false);
  }, [summary.id, summary.draft_md, summary.approved_md]);

  const noticeId = `summary-notice-${summary.id}`;

  function submit() {
    approve.mutate(
      { summaryId: summary.id, approvedMd: text },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success(t("summary.approved"));
        },
        onError: (error) =>
          toast.error(errorMessageOf(error) ?? t("common:errors.unexpected")),
      },
    );
  }

  return (
    <div className="flex flex-col gap-block">
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
            at: new Date(summary.approved_at).toLocaleDateString("ru-RU"),
          })}
        </p>
      )}

      {editing ? (
        <form
          className="flex flex-col gap-block"
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
            onChange={(event) => setText(event.target.value)}
          />
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
              from: summary.period_start,
              to: summary.period_end,
            })}
            description={t("summary.confirm.description")}
            confirmLabel={t("summary.approve")}
            cancelLabel={t("common:actions.cancel")}
            destructive={false}
            onConfirm={submit}
          />
        </form>
      ) : (
        <>
          <p
            className={
              approved
                ? "m-0 whitespace-pre-line border-l-4 border-l-success pl-block text-sm"
                : "m-0 whitespace-pre-line border-l-4 border-l-warning pl-block text-sm"
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
          <li key={`${check.kind}-${index}`} className="text-sm">
            <span className={check.hard ? "text-destructive" : "text-warning"}>
              {t(`summary.checks.kind.${check.kind}`, {
                defaultValue: t("summary.checks.kind.other"),
              })}
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
