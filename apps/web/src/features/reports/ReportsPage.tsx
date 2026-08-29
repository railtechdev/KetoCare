import { AsyncSection, Button, Section, Skeleton, toast } from "@ketocare/ui";
import { Download, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { useSession } from "../auth/useSession";
import { toDateInput } from "../diary/time";
import {
  useReport,
  useReportJob,
  useRequestPdfMutation,
  type ReportRange,
  type SeizureByType,
} from "./useReports";

const AMOUNT = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

function monthAgo(): string {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return toDateInput(date);
}

/**
 * Отчёт по пациенту за период (раздел 8.3 ТЗ, строка «Отчёт»).
 *
 * Экран показывает то же, что уедет в PDF и в CSV: расхождение между тем, что
 * врач видел, и тем, что напечаталось, — клинический риск. Поэтому и здесь, и
 * там одни и те же числа приходят одним запросом.
 */
export function ReportsPage({ patientId }: { patientId: string }) {
  const { t } = useTranslation("reports");
  const { session } = useSession();

  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [jobId, setJobId] = useState<string | null>(null);

  const range = useMemo<ReportRange>(() => ({ from, to }), [from, to]);
  const invalidRange = from === "" || to === "" || from > to;

  const report = useReport(patientId, range);
  const requestPdf = useRequestPdfMutation(patientId);
  const job = useReportJob(jobId);

  const isDoctor = session?.role === "doctor";

  const csvHref = `/api/v1/patients/${patientId}/report?from=${from}&to=${to}&format=csv`;
  const pdfHref =
    job.data?.status === "done"
      ? `/api/v1/reports/jobs/${job.data.id}/file`
      : null;

  return (
    <PageLayout
      title={t("title")}
      intro={t("intro")}
      actions={
        <Button
          type="button"
          disabled={invalidRange || requestPdf.isPending}
          onClick={() =>
            requestPdf.mutate(range, {
              onSuccess: (created) => {
                setJobId(created.id);
                toast.success(t("pdf.queued"));
              },
              onError: (error) =>
                toast.error(
                  errorMessageOf(error) ?? t("common:errors.unexpected"),
                ),
            })
          }
        >
          <FileText aria-hidden="true" />
          {t("pdf.request")}
        </Button>
      }
    >
      <Section title={t("period.title")} contentClassName="gap-field">
        <div className="flex flex-wrap items-end gap-block">
          <Field
            id="report-from"
            type="date"
            width="date"
            label={t("period.from")}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <Field
            id="report-to"
            type="date"
            width="date"
            label={t("period.to")}
            error={invalidRange ? t("period.invalid") : undefined}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>

        {/* Выгрузка — только врачу (раздел 8.3 ТЗ): файл уезжает из продукта, и
            дальше его судьбу никто не контролирует. Это UX, право проверяет
            сервер. */}
        {isDoctor && (
          <Button asChild variant="outline" className="min-h-touch self-start">
            {/* Обычная ссылка, а не запрос с токеном: веб-кабинет
                аутентифицируется httpOnly-cookie (раздел 5.2 ТЗ), и браузер
                приложит её сам. Скачивание потоком, без сборки файла в памяти
                вкладки, и без ручного fetch — их во фронтенде быть не должно. */}
            <a href={csvHref} download>
              <Download aria-hidden="true" />
              {t("csv.download")}
            </a>
          </Button>
        )}
      </Section>

      {jobId !== null && (
        <Section title={t("pdf.title")}>
          {job.data?.status === "done" && pdfHref !== null ? (
            <Button asChild className="min-h-touch self-start">
              <a href={pdfHref} download>
                <Download aria-hidden="true" />
                {t("pdf.download")}
              </a>
            </Button>
          ) : job.data?.status === "failed" ? (
            <p className="m-0 text-sm text-destructive">{t("pdf.failed")}</p>
          ) : (
            <p role="status" className="m-0 text-sm text-muted-foreground">
              {t("pdf.building")}
            </p>
          )}
        </Section>
      )}

      <AsyncSection
        loading={report.isLoading}
        skeleton={
          <div
            className="flex flex-col gap-block"
            role="status"
            aria-busy="true"
          >
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        }
        error={
          report.isError
            ? {
                title: t("errors.load"),
                description:
                  errorMessageOf(report.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void report.refetch()}
        isEmpty={report.data === undefined}
        empty={null}
      >
        {report.data !== undefined && (
          <>
            <Section title={t("seizures.title")}>
              <p className="m-0">
                {t("seizures.total", {
                  count: report.data.seizures.count,
                  entries: report.data.seizures.entries,
                })}
              </p>
              {report.data.seizures.by_type.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-field p-0">
                  {report.data.seizures.by_type.map((item: SeizureByType) => (
                    <li
                      key={item.seizure_type_id}
                      className="flex flex-wrap items-baseline gap-field"
                    >
                      <span className="font-medium">{item.name_ru}</span>
                      {item.code !== null && (
                        <span className="text-sm text-muted-foreground">
                          {item.code}
                        </span>
                      )}
                      <span className="tabular-nums">{item.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t("measurements.title")}>
              <dl className="m-0 grid gap-block sm:grid-cols-2">
                <Measurement
                  label={t("measurements.ketones")}
                  series={report.data.ketones}
                  unit={t("measurements.unitKetones")}
                />
                <Measurement
                  label={t("measurements.weight")}
                  series={report.data.weight}
                  unit={t("measurements.unitWeight")}
                />
              </dl>
            </Section>

            <Section title={t("menu.title")}>
              <p className="m-0">
                {t("menu.summary", {
                  days: report.data.menu.days_planned,
                  planned: report.data.menu.items_planned,
                  eaten: report.data.menu.items_eaten,
                })}
              </p>
            </Section>
          </>
        )}
      </AsyncSection>
    </PageLayout>
  );
}

function Measurement({
  label,
  series,
  unit,
}: {
  label: string;
  series: {
    points: unknown[];
    min: number | null;
    max: number | null;
    mean: number | null;
  };
  unit: string;
}) {
  const { t } = useTranslation("reports");

  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="m-0 tabular-nums">
        {series.mean === null
          ? t("measurements.empty")
          : t("measurements.value", {
              mean: AMOUNT.format(series.mean),
              min: AMOUNT.format(series.min ?? 0),
              max: AMOUNT.format(series.max ?? 0),
              count: series.points.length,
              unit,
            })}
      </dd>
    </div>
  );
}
