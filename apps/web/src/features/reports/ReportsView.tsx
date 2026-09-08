import {
  AsyncSection,
  Button,
  FilterBar,
  Metric,
  MetricRow,
  Section,
  Skeleton,
  Tiles,
  toast,
} from "@ketocare/ui";
import { Download, FileText } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { DoctorSummaryPanel } from "./DoctorSummaryPanel";
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
 * Содержимое отчёта — без оболочки экрана.
 *
 * Оболочку ставит вызывающий: у семьи это свой экран `/app/reports`, у врача —
 * вкладка карты пациента. Врач до отчёта не доходил вовсе, хотя раздел 1 ТЗ
 * называет отчёты врачебной функцией, а CSV сервер отдаёт исключительно ему
 * (`reports.py`): экран был написан для врача и физически им недостижим.
 *
 * Вложить сюда `PageLayout` нельзя: в карте пациента заголовок уже есть, и
 * второй дал бы `h1` внутри `h1`.
 */
export function ReportsView({ patientId }: { patientId: string }) {
  const { t } = useTranslation("reports");
  const { session } = useSession();

  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(() => toDateInput(new Date()));
  // Задача сборки живёт в адресе, а не в состоянии экрана: PDF собирается
  // воркером секундами, и до этого идентификатор терялся при обновлении
  // страницы и при уходе в другой раздел. Готовый файл после этого достать было
  // нечем — у API нет ручки «мои задачи», только выдача по идентификатору, — и
  // человек заказывал сборку заново, второй раз занимая воркер.
  //
  // Маршрут не назван намеренно (`strict: false`): экран живёт под двумя
  // адресами — `/app/reports` у семьи и `/app/patients/<id>/reports` у врача, —
  // и привязка к одному из них роняла бы его на другом. Параметр при этом
  // объявлен обоими маршрутами: не объявленный в `validateSearch` теряется
  // молча.
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const jobId = search.job ?? null;

  const setJobId = useCallback(
    (next: string | null) => {
      void navigate({
        // «Здесь же»: маршрут не назван, потому что экран стоит под двумя.
        to: ".",
        search: (previous) => ({ ...previous, job: next ?? undefined }),
        replace: true,
      });
    },
    [navigate],
  );
  // Момент постановки задачи: по нему видно, что сборка затянулась. Воркер
  // может быть не поднят вовсе (PDF требует системных pango и cairo), и тогда
  // экран бесконечно показывал «Готовим файл», пока открыта вкладка.
  const [requestedAt, setRequestedAt] = useState<number | null>(null);

  const range = useMemo<ReportRange>(() => ({ from, to }), [from, to]);
  const invalidRange = from === "" || to === "" || from > to;

  const report = useReport(patientId, range);
  const requestPdf = useRequestPdfMutation(patientId);
  const job = useReportJob(jobId);
  const takingLong = useTakingLong(requestedAt, job.data?.status);

  const isDoctor = session?.role === "doctor";

  function retry() {
    requestPdf.mutate(range, {
      onSuccess: (created) => {
        setJobId(created.id);
        setRequestedAt(Date.now());
      },
      onError: (error) =>
        toast.error(errorMessageOf(error) ?? t("common:errors.unexpected")),
    });
  }

  const csvHref = `/api/v1/patients/${patientId}/report?from=${from}&to=${to}&format=csv`;
  const pdfHref =
    job.data?.status === "done"
      ? `/api/v1/reports/jobs/${job.data.id}/file`
      : null;

  return (
    <>
      <Section
        title={t("period.title")}
        contentClassName="gap-field"
        /* Сборка PDF — действие периода, а не экрана: она уезжает вместе с
           выбранными датами. В шапку её вынести нельзя — у врача отчёт
           открывается вкладкой карты пациента, и шапка там принадлежит карте
           (правило П31 канона). */
        action={
          <Button
            type="button"
            disabled={invalidRange || requestPdf.isPending}
            onClick={() =>
              requestPdf.mutate(range, {
                onSuccess: (created) => {
                  setJobId(created.id);
                  setRequestedAt(Date.now());
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
        <FilterBar label={t("period.legend")}>
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
        </FilterBar>

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
            /* У отказа обязано быть действие (правило П16 канона): раньше
               здесь была одна красная строка, и дальше человек не мог ничего —
               ни повторить, ни понять, ждать ли. */
            <div className="flex flex-col items-start gap-field">
              <p className="m-0 text-sm text-destructive">{t("pdf.failed")}</p>
              <Button
                type="button"
                variant="outline"
                className="min-h-touch"
                disabled={requestPdf.isPending}
                onClick={() => retry()}
              >
                {t("pdf.retry")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-field">
              <p role="status" className="m-0 text-sm text-muted-foreground">
                {takingLong ? t("pdf.slow") : t("pdf.building")}
              </p>
              {takingLong && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-touch"
                  disabled={requestPdf.isPending}
                  onClick={() => retry()}
                >
                  {t("pdf.retry")}
                </Button>
              )}
            </div>
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
            {/* Три коротких блока — рядом. Столбиком они занимали три экрана
                прокрутки при том, что в каждом одна-две строки, а справа было
                пусто. Сколько столбцов — решает ширина, а не брейкпоинт. */}
            <Tiles min="sm">
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
                {/* Ряд показателей вместо `sm:grid-cols-2`: тот же блок стоит и
                  во всю ширину экрана отчёта, и во вкладке карты пациента, и
                  вопрос о ширине ОКНА в обоих местах отвечал неверно. */}
                <MetricRow min="wide" label={t("measurements.title")}>
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
                </MetricRow>
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
            </Tiles>

            {/* Утверждённые сводки: до этого блока они были в PDF и в выгрузке,
                но не на экране — ADR-0008 обещает обратное, а расхождение
                экрана и печати в клиническом документе и есть тот риск, ради
                которого обещание давалось. Сервер отдаёт этот раздел только
                специалисту. */}
            {report.data.summaries.length > 0 && (
              <Section title={t("summary.approvedTitle")}>
                {report.data.summaries.map((item) => (
                  <div
                    key={`${item.period_start}-${item.period_end}`}
                    className="flex flex-col gap-field"
                  >
                    <p className="m-0 text-sm text-muted-foreground">
                      {t("summary.periodLine", {
                        from: item.period_start,
                        to: item.period_end,
                      })}
                    </p>
                    <p className="m-0 whitespace-pre-line text-sm">
                      {item.approved_md}
                    </p>
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
      </AsyncSection>

      {/* Черновик сводки — только врачу. Это UX: право проверяет сервер,
          ручки сводки закрыты ролью и `require_patient_access`. */}
      {isDoctor && (
        <DoctorSummaryPanel
          patientId={patientId}
          range={range}
          disabled={invalidRange}
        />
      )}
    </>
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

  // Своя разметка пары «подпись — значение» здесь была ровно такой же, как в
  // ките: одна и та же пара писалась в семи местах семью способами, и
  // моноширинные цифры стояли в пяти из них.
  return (
    <Metric
      label={label}
      value={
        series.mean === null
          ? t("measurements.empty")
          : t("measurements.value", {
              mean: AMOUNT.format(series.mean),
              min: AMOUNT.format(series.min ?? 0),
              max: AMOUNT.format(series.max ?? 0),
              count: series.points.length,
              unit,
            })
      }
    />
  );
}

/**
 * Сборка идёт дольше обычного.
 *
 * Порог — не про производительность, а про честность экрана: воркер может быть
 * не поднят вовсе, и тогда задача не соберётся никогда. Молча крутить
 * «Готовим файл» в таком случае — обещание, которое некому выполнить.
 */
function useTakingLong(
  requestedAt: number | null,
  status: string | undefined,
): boolean {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (requestedAt === null || status === "done" || status === "failed")
      return;
    const timer = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, [requestedAt, status]);

  if (requestedAt === null || status === "done" || status === "failed") {
    return false;
  }
  return now - requestedAt > SLOW_AFTER_MS;
}

/** Полминуты: обычная сборка укладывается в несколько секунд. */
const SLOW_AFTER_MS = 30_000;
