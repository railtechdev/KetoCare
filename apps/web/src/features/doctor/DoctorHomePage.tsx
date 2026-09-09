import {
  AsyncSection,
  Button,
  Columns,
  EmptyState,
  Metric,
  MetricRow,
  Section,
} from "@ketocare/ui";
import { CircleCheck, Users } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { SectionLink } from "../../components/SectionLink";
import { errorMessageOf } from "../../lib/api";
import { usePatients } from "../patients/usePatients";
import { PatientFlagsLegend, PatientFlagsView } from "./PatientFlagsView";
import { PatientViewLink } from "./PatientViewLink";
import type { PatientView } from "./patientViews";
import { usePatientOverviews } from "./doctorQueries";
import { attentionRank, computePatientFlags, type PatientFlags } from "./flags";
import { LinesSkeleton } from "./skeletons";
import type { Patient } from "./types";

/**
 * Сколько пациентов показывать в очереди.
 *
 * Очередь — это «кем заняться сейчас», а не второй список пациентов: длинная
 * она перестаёт быть очередью и повторяет таблицу раздела «Пациенты». Когда
 * помеченных больше, разница названа прямо и уводит в полный список.
 */
const QUEUE_LIMIT = 6;

interface QueueRow {
  patient: Patient;
  flags: PatientFlags;
  rank: number;
}

/**
 * Раздел карты, на который ведёт строка очереди.
 *
 * Флаг существует, чтобы вызвать действие, и действие у каждого своё: молчание
 * семьи проверяют в дневниках, отклонение соотношения — в плане питания за
 * день. Открывать карту на сводке значило бы требовать ещё один клик там, где
 * известно, куда именно идти.
 */
function viewForFlags(flags: PatientFlags): PatientView {
  if (flags.noPrescription) return "prescription";
  return flags.staleData ? "diary" : "menu";
}

/**
 * Главная врача — «кем заняться» (`docs/DESIGN_PROPOSAL.md`).
 *
 * Вход врача вёл сразу в таблицу пациентов: полный реестр вместо ответа на
 * вопрос, с которого начинается рабочий день. Реестр отвечает «кто у меня
 * есть», а нужно «кто требует действия сейчас».
 *
 * Двух блоков из предложения здесь нет, и это не забывчивость: «приёмы на
 * неделю» ждут графика наблюдения, которого в продукте пока нет, а «недавние
 * изменения» — серверной ленты событий; собирать её обходом дневников значило
 * бы шесть запросов на каждого пациента. Блок, за которым нет данных, — хуже
 * его отсутствия (правило П3 канона).
 *
 * Сводки приходят по одной на пациента — тем же запросом, что и в списке, и
 * из общего кэша: открыв затем «Пациентов», врач не ждёт их второй раз.
 */
export function DoctorHomePage() {
  const { t } = useTranslation("doctor");

  const patients = usePatients();
  const items = useMemo(() => patients.data?.items ?? [], [patients.data]);
  const overviews = usePatientOverviews(
    useMemo(() => items.map((patient) => patient.id), [items]),
  );

  const settled = !overviews.pending;

  const { queue, flagged, waiting, silent, offTolerance, unknown } =
    useMemo(() => {
      const rows: QueueRow[] = [];
      let waiting = 0;
      let silent = 0;
      let offTolerance = 0;
      let unknown = 0;

      for (const patient of items) {
        const overview = overviews.byPatientId.get(patient.id) ?? null;
        const flags = computePatientFlags(overview);

        // Сводка не пришла — это «неизвестно», а не «замечаний нет». Такой
        // пациент в очередь не попадает (порядок задан `attentionRank`), но и
        // молчать о нём нельзя: триаж, выдающий «всё хорошо» там, где ничего не
        // известно, — худшая из его ошибок (правило П19 канона).
        if (flags === null) {
          unknown += 1;
          continue;
        }

        if (flags.noPrescription) waiting += 1;
        if (flags.staleData) silent += 1;
        if (flags.nutritionOff) offTolerance += 1;

        const rank = attentionRank(flags);
        if (rank > 0) rows.push({ patient, flags, rank });
      }

      rows.sort(
        (a, b) =>
          b.rank - a.rank ||
          a.patient.full_name.localeCompare(b.patient.full_name, "ru-RU"),
      );

      return {
        queue: rows.slice(0, QUEUE_LIMIT),
        flagged: rows.length,
        waiting,
        silent,
        offTolerance,
        unknown,
      };
    }, [items, overviews.byPatientId]);

  return (
    // Главная врача — рабочая страница: очередь внимания и цифры по когорте
    // стояли друг под другом в колонке 1152 px, при том что справа было пусто.
    <PageLayout
      title={t("home.title")}
      intro={t("home.intro")}
      width="wide"
      density="compact"
    >
      <Columns
        asideLabel={t("home.cohort.title")}
        asideSticky
        main={
          <Section
            title={t("home.queue.title")}
            description={t("home.queue.intro")}
            action={
              <Button asChild variant="outline">
                <SectionLink section="patients">
                  {t("home.queue.toList")}
                </SectionLink>
              </Button>
            }
          >
            <AsyncSection
              loading={patients.isPending || !settled}
              skeleton={
                <LinesSkeleton label={t("home.queue.loading")} lines={4} />
              }
              error={
                patients.isError
                  ? {
                      title: t("home.queue.loadError"),
                      description:
                        errorMessageOf(patients.error) ??
                        t("common:errors.unexpected"),
                    }
                  : null
              }
              retryLabel={t("common:actions.retry")}
              onRetry={() => void patients.refetch()}
              isEmpty={queue.length === 0}
              empty={
                <EmptyState
                  icon={items.length === 0 ? Users : CircleCheck}
                  title={
                    items.length === 0
                      ? t("home.queue.noPatients")
                      : t("home.queue.allCalm")
                  }
                  description={
                    items.length === 0
                      ? t("home.queue.noPatientsHint")
                      : t("home.queue.allCalmHint")
                  }
                />
              }
            >
              <ul className="m-0 flex list-none flex-col gap-field p-0">
                {queue.map((row) => (
                  <li
                    key={row.patient.id}
                    className="flex flex-wrap items-center gap-field rounded-lg border border-border px-3 py-2"
                  >
                    {/* Имя — ссылка на карту: врач открывает её в новой вкладке и
                    пересылает коллеге (правило П1 канона). */}
                    <PatientViewLink
                      patientId={row.patient.id}
                      view={viewForFlags(row.flags)}
                      className="min-w-0 flex-1 font-medium break-words underline-offset-2 hover:underline"
                    >
                      {row.patient.full_name}
                    </PatientViewLink>
                    <PatientFlagsView flags={row.flags} />
                  </li>
                ))}
              </ul>

              {flagged > queue.length && (
                <p className="m-0 text-sm text-muted-foreground">
                  {t("home.queue.more", { count: flagged - queue.length })}
                </p>
              )}

              <PatientFlagsLegend />
            </AsyncSection>
          </Section>
        }
        aside={
          <Section
            title={t("home.cohort.title")}
            description={t("home.cohort.intro")}
          >
            {/* Ряд показателей, а не список пар: в приставной колонке он встанет
                в один-два столбца, а во всю ширину — в четыре. Сколько именно,
                решает ширина САМОГО ряда, поэтому блок верен и здесь, и если
                однажды переедет на всю ширину экрана. */}
            <MetricRow label={t("home.cohort.title")}>
              <Metric label={t("home.cohort.total")} value={items.length} />

              {/* Первым: пациент без назначения ждёт не наблюдения, а решения
                  врача. */}
              <Metric
                label={t("home.cohort.waiting")}
                value={settled ? waiting : "…"}
              />
              <Metric
                label={t("home.cohort.silent")}
                value={settled ? silent : "…"}
              />
              <Metric
                label={t("home.cohort.offTolerance")}
                value={settled ? offTolerance : "…"}
              />

              {/* Показатель появляется, только когда есть о чём молчать: ноль
                  непрочитанных сводок — не показатель, а шум. */}
              {settled && unknown > 0 && (
                <Metric
                  label={t("home.cohort.unknown")}
                  value={unknown}
                  hint={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-ml-3 min-h-touch"
                      onClick={() => overviews.refetch()}
                    >
                      {t("common:actions.retry")}
                    </Button>
                  }
                />
              )}
            </MetricRow>
          </Section>
        }
      />
    </PageLayout>
  );
}
