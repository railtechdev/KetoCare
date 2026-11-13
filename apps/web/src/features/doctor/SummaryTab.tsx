import {
  dayVerdict,
  toleranceGapKey,
  formatGrams,
  AsyncSection,
  Button,
  Columns,
  EmptyState,
  FactList,
  MacroBar,
  Metric,
  MetricRow,
  RatioBadge,
  Section,
  WarningBanner,
  formatKcal,
  formatOccurredAt,
  formatMeasured,
  formatNumber,
  formatWeight,
  formatDayMonth,
  formatRatio,
  parseDateInput,
} from "@ketocare/ui";
import { CalendarOff, ClipboardList, KeyRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { formatIsoDate } from "./dates";
import { toDateInput } from "../diary/time";
import { useReport } from "../reports/useReports";
import { firstAndLast, periodStart, seizuresByWeek } from "./lastDays";
import { ACCESS_CODE_ITEM } from "./patientViews";
import { usePatientOverview } from "../patients/overview";
import { DayTargetBars } from "../menu/DayTargetBars";
import { PatientViewLink } from "./PatientViewLink";
import { LinesSkeleton } from "./skeletons";
import type { Patient, PatientOverview } from "./types";
import { queryState } from "../../lib/queryState";

/**
 * Раздел «Сводка»: что с ребёнком сейчас.
 *
 * Клиническая часть приходит одним запросом `/patients/{id}/overview`:
 * назначение, итоги дня против него, последние замеры и приступы за сегодня
 * собраны сервером на один момент времени.
 *
 * Анамнеза здесь больше нет. Анкета, медицинский профиль, документы, семья и
 * ведущие специалисты уехали в раздел «Профиль»: сводку открывают, чтобы
 * увидеть состояние на сегодня, и шесть блоков анамнеза под ней превращали
 * ответ на этот вопрос в пролистывание.
 *
 * Под сегодняшним днём — «За 30 дней» (аудит продукта 12.11.2026): приступы,
 * кетоны, вес и съеденное за месяц. Раньше за этим шли в «Отчёт» и ждали файл.
 */
export function SummaryTab({ patient }: { patient: Patient }) {
  const { t } = useTranslation("doctor");
  const overview = usePatientOverview(patient.id);

  return (
    <div className="flex flex-col gap-section">
      {/* Четыре состояния — общим компонентом. Рукописная цепочка прятала
          уже загруженную сводку за сообщением об ошибке: TanStack Query при
          неудачном ОБНОВЛЕНИИ сохраняет прежний ответ и одновременно
          переводит запрос в состояние ошибки (правило П15 канона). */}
      <AsyncSection
        {...queryState(overview)}
        skeleton={<LinesSkeleton label={t("summary.loading")} lines={5} />}
        error={
          overview.isError
            ? {
                title: t("summary.loadError"),
                description:
                  errorMessageOf(overview.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void overview.refetch()}
        isEmpty={overview.data === undefined}
        empty={null}
      >
        {overview.data !== undefined && (
          <OverviewPanels data={overview.data} patientId={patient.id} />
        )}
      </AsyncSection>
    </div>
  );
}

function OverviewPanels({
  data,
  patientId,
}: {
  data: PatientOverview;
  patientId: string;
}) {
  const { t } = useTranslation("doctor");

  const prescription = data.prescription ?? null;
  // Версия с «Действует с» позже сегодня: день по ней ещё не судится
  // (правило действующего назначения, аудит расчётов 13.11.2026).
  const upcoming = data.upcoming_prescription ?? null;
  const upcomingStarts =
    upcoming === null ? null : parseDateInput(upcoming.effective_from);
  const upcomingNote =
    upcoming === null || upcomingStarts === null ? null : (
      <p className="text-sm">
        {t("summary.prescription.upcoming", {
          date: formatDayMonth(upcomingStarts),
          ratio: formatRatio(upcoming.ratio),
          kcal: formatKcal(upcoming.kcal_per_day),
        })}
      </p>
    );
  const day = data.day ?? null;
  const tolerance = day?.tolerance ?? null;

  // Что показывать предупреждением, а что набором, решает `dayVerdict` кита —
  // одинаково для главной родителя, меню и этой карты.
  const verdict = dayVerdict(tolerance, day?.tolerance_gap ?? null);

  return (
    <Columns
      asideLabel={t("summary.prescription.title")}
      asideSticky
      main={
        <>
          {/* Семья не подключена — одной строкой с действием, а не пометкой
              без продолжения: код выдаётся в «Профиле и семье», панель
              открывается сразу (`?item=access-code`). */}
          {data.family_activated === false && (
            <div className="flex flex-wrap items-center gap-field rounded-lg border border-border px-3 py-2">
              <span className="font-medium">
                {t("summary.family.notConnected")}
              </span>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="min-h-touch"
              >
                <PatientViewLink
                  patientId={patientId}
                  view="profile"
                  item={ACCESS_CODE_ITEM}
                >
                  <KeyRound aria-hidden="true" />
                  {t("summary.family.issueCode")}
                </PatientViewLink>
              </Button>
            </div>
          )}

          <Section title={t("summary.day.title")}>
            {day === null ? (
              <EmptyState
                icon={CalendarOff}
                title={t("summary.day.empty")}
                description={t("summary.day.emptyDescription")}
                // Специалист составляет день тем же экраном, что и семья
                // (ADR-0047): «ждать, пока семья запланирует» больше не
                // единственный путь, и у пустого дня есть выход.
                action={
                  <Button asChild variant="outline">
                    <PatientViewLink patientId={patientId} view="menu">
                      {t("summary.day.compose")}
                    </PatientViewLink>
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-col gap-section">
                <div className="flex flex-wrap items-center gap-section">
                  {/* Вердикт о соответствии приходит от сервера: допуски — константы
                      расчётного ядра, на клиенте их копии нет (правило 2 CLAUDE.md). */}
                  <RatioBadge
                    ratio={day.totals.ratio}
                    withinTolerance={
                      tolerance?.ratio_within_tolerance ?? undefined
                    }
                  />
                  <span className="font-semibold tabular-nums">
                    {t("units.kcal", { value: formatKcal(day.totals.kcal) })}
                  </span>
                </div>

                <MacroBar
                  fatG={day.totals.fat}
                  proteinG={day.totals.protein}
                  carbsG={day.totals.carbs}
                />

                {/* Цели полосой, как в меню и на главной семьи (П40): один день,
                    показанный в трёх местах, читается одинаково. */}
                {prescription !== null && (
                  <DayTargetBars
                    kcal={day.totals.kcal}
                    carbs={day.totals.carbs}
                    kcalTarget={prescription.kcal_per_day}
                    carbsLimit={prescription.carbs_limit_g}
                  />
                )}

                {verdict.unavailable ? (
                  <p className="m-0 text-sm text-muted-foreground">
                    {t(
                      `summary.day.${toleranceGapKey(verdict.unavailableReason)}`,
                    )}
                  </p>
                ) : verdict.ratioOffTolerance ? (
                  <WarningBanner
                    level="warning"
                    title={t("summary.day.offTitle")}
                  >
                    {t("summary.day.offRatio")}
                  </WarningBanner>
                ) : verdict.ratioUnknown ? (
                  <p
                    role="status"
                    className="m-0 text-sm text-muted-foreground"
                  >
                    {t("summary.day.ratioUnknown")}
                  </p>
                ) : (
                  <p role="status" className="m-0 text-sm text-success">
                    {t("summary.day.within")}
                  </p>
                )}

                {/* Лимит углеводов сервер сверяет с 13.11.2026 (аудит
                    расчётов): до того день с двойным превышением получал
                    «соответствует назначению». */}
                {verdict.carbsOverLimit && (
                  <WarningBanner
                    level="warning"
                    title={t("summary.day.carbsTitle")}
                  >
                    {t("summary.day.carbsBody")}
                  </WarningBanner>
                )}

                {verdict.kcalBelowTarget && (
                  <p className="m-0 text-sm text-muted-foreground">
                    {t("summary.day.kcalBelowTarget", {
                      value: formatKcal(day.totals.kcal),
                      target: formatKcal(prescription?.kcal_per_day ?? 0),
                    })}
                  </p>
                )}
              </div>
            )}
          </Section>

          <Section title={t("summary.readings.title")}>
            <MetricRow label={t("summary.readings.title")}>
              <Metric
                label={t("summary.readings.ketone")}
                // Крупно — само измерение, мелко под ним — способ и время.
                // Одной строкой «2,4 ммоль/л, по крови, 12.11.2026, 21:47»
                // плитка на ноутбуке рвалась посреди единицы измерения.
                value={
                  data.last_ketone == null
                    ? t("summary.readings.noKetone")
                    : t("summary.readings.ketoneAmount", {
                        value: formatMeasured(data.last_ketone.value),
                      })
                }
                hint={
                  data.last_ketone != null &&
                  t("summary.readings.ketoneWhen", {
                    method: t(
                      `summary.readings.method.${data.last_ketone.method}`,
                    ),
                    at: formatOccurredAt(
                      new Date(data.last_ketone.occurred_at),
                    ),
                  })
                }
              />
              <Metric
                label={t("summary.readings.weight")}
                value={
                  data.last_weight == null
                    ? t("summary.readings.noWeight")
                    : t("summary.readings.weightAmount", {
                        value: formatWeight(data.last_weight.weight_kg),
                      })
                }
                hint={
                  data.last_weight != null &&
                  formatOccurredAt(new Date(data.last_weight.occurred_at))
                }
              />
              <Metric
                label={t("summary.readings.seizures")}
                value={t("summary.readings.seizuresValue", {
                  count: data.seizures_today.count,
                })}
                hint={t("summary.readings.seizuresEntries", {
                  entries: data.seizures_today.entries,
                })}
              />
            </MetricRow>
          </Section>

          {/* Месяц — под сегодняшним днём и своим запросом: сегодняшняя
              сводка не ждёт сборки отчёта за тридцать дней. */}
          <LastDaysSection patientId={patientId} />
        </>
      }
      aside={
        <Section title={t("summary.prescription.title")} tone="accent">
          {prescription === null ? (
            (upcomingNote ?? (
              <EmptyState
                icon={ClipboardList}
                title={t("summary.prescription.empty")}
                action={
                  // Ссылкой, а не кнопкой: раздел живёт по адресу, и переход к
                  // назначению открывается в новой вкладке и пересылается коллеге
                  // (правило П1 канона). Кнопка со сменой вкладки ничего этого не
                  // умела. Назначение — первое, что от врача требуется у нового
                  // пациента, и путь к нему не должен быть длиннее одного клика.
                  <Button asChild>
                    <PatientViewLink patientId={patientId} view="prescription">
                      {t("summary.prescription.toTab")}
                    </PatientViewLink>
                  </Button>
                }
              />
            ))
          ) : (
            <FactList>
              <dt className="text-muted-foreground">{t("fields.ratio")}</dt>
              <dd className="m-0">
                {/* Вердикт о допуске здесь не показывается: это сама цель
                    назначения, а не измерение, которое с ней сравнивают. */}
                <RatioBadge ratio={prescription.ratio} />
              </dd>

              <dt className="text-muted-foreground">{t("fields.kcal")}</dt>
              <dd className="m-0 tabular-nums">
                {t("units.kcalPerDay", {
                  value: formatKcal(prescription.kcal_per_day),
                })}
              </dd>

              <dt className="text-muted-foreground">{t("fields.protein")}</dt>
              <dd className="m-0 tabular-nums">
                {t("units.gramsPerDay", {
                  value: formatGrams(prescription.protein_g),
                })}
              </dd>

              <dt className="text-muted-foreground">
                {t("fields.carbsLimit")}
              </dt>
              <dd className="m-0 tabular-nums">
                {t("units.gramsPerDay", {
                  value: formatGrams(prescription.carbs_limit_g),
                })}
              </dd>

              <dt className="text-muted-foreground">{t("fields.meals")}</dt>
              <dd className="m-0 tabular-nums">{prescription.meals_per_day}</dd>

              {/* Жидкость необязательна (ADR-0069): не задана — строки нет. */}
              {prescription.fluid_ml_per_day != null && (
                <>
                  <dt className="text-muted-foreground">{t("fields.fluid")}</dt>
                  <dd className="m-0 tabular-nums">
                    {t("units.mlPerDay", {
                      value: formatNumber(prescription.fluid_ml_per_day, 0),
                    })}
                  </dd>
                </>
              )}

              <dt className="text-muted-foreground">
                {t("fields.effectiveFrom")}
              </dt>
              <dd className="m-0 tabular-nums">
                {formatIsoDate(prescription.effective_from) ?? "—"}
              </dd>

              {prescription.restrictions !== null && (
                <>
                  <dt className="text-muted-foreground">
                    {t("fields.restrictions")}
                  </dt>
                  <dd className="m-0">{prescription.restrictions}</dd>
                </>
              )}
            </FactList>
          )}
          {prescription !== null && upcomingNote}
          {prescription !== null && (
            // The dietitian looked for a way to change the prescription here and
            // found none: the form lives in the «Диета» section. One link keeps
            // the path a single click, as for the first prescription above.
            <Button asChild variant="outline" className="self-start">
              <PatientViewLink patientId={patientId} view="prescription">
                {t("summary.prescription.edit")}
              </PatientViewLink>
            </Button>
          )}
        </Section>
      }
    />
  );
}

/**
 * «За 30 дней»: приступы по неделям, кетоны и вес — крайние и последние
 * значения, съеденное из меню.
 *
 * Числа — из отчёта за тот же период (`/patients/{id}/report`): «Обзор» и
 * «Отчёт» за одни даты обязаны совпадать, поэтому второй сборки агрегатов
 * здесь нет. В браузере только раскладка приступов по неделям и выбор первого
 * и последнего замера — счёт, а не медицинский расчёт.
 */
function LastDaysSection({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const [to] = useState(() => toDateInput(new Date()));
  const from = periodStart(to);
  const report = useReport(patientId, { from, to });
  const data = report.data;

  return (
    <Section
      title={t("summary.month.title")}
      action={
        <Button asChild variant="outline" size="sm" className="min-h-touch">
          <PatientViewLink patientId={patientId} view="reports">
            {t("summary.month.toReport")}
          </PatientViewLink>
        </Button>
      }
    >
      <AsyncSection
        {...queryState(report)}
        skeleton={
          <LinesSkeleton label={t("summary.month.loading")} lines={3} />
        }
        error={
          report.isError
            ? {
                title: t("summary.month.loadError"),
                description:
                  errorMessageOf(report.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void report.refetch()}
        isEmpty={data === undefined}
        empty={null}
      >
        {data !== undefined && (
          <MetricRow label={t("summary.month.title")}>
            <Metric
              label={t("summary.month.seizures")}
              value={t("summary.month.seizuresTotal", {
                count: data.seizures.count,
              })}
              hint={
                data.seizures.count > 0 && (
                  <ul className="m-0 flex list-none flex-col p-0">
                    {seizuresByWeek(data.seizures.by_day, to).map((week) => (
                      <li key={week.from}>
                        {t("summary.month.week", {
                          from: formatDayMonth(isoToLocal(week.from)),
                          to: formatDayMonth(isoToLocal(week.to)),
                          count: week.count,
                        })}
                      </li>
                    ))}
                  </ul>
                )
              }
            />
            {/* Кровь и моча — разные шкалы: один диапазон «от 0,5 до 8,0»
                на оба метода не значил ничего (аудит расчётов 13.11.2026).
                Моча — отдельной плиткой, только когда за месяц её мерили. */}
            {(
              [
                ["ketonesBlood", data.ketones_blood],
                ["ketonesUrine", data.ketones_urine],
              ] as const
            )
              .filter(
                ([key, series]) =>
                  key === "ketonesBlood" || series.points.length > 0,
              )
              .map(([key, series]) => (
                <Metric
                  key={key}
                  label={t(`summary.month.${key}`)}
                  value={
                    series.min === null || series.max === null
                      ? t("summary.month.noReadings")
                      : t("summary.month.ketoneRange", {
                          min: formatMeasured(series.min),
                          max: formatMeasured(series.max),
                        })
                  }
                  hint={(() => {
                    const ends = firstAndLast(series.points);
                    return ends === null
                      ? undefined
                      : t("summary.month.ketoneLast", {
                          value: formatMeasured(ends.last.value),
                          at: formatOccurredAt(new Date(ends.last.at)),
                        });
                  })()}
                />
              ))}
            <Metric
              label={t("summary.month.weight")}
              value={(() => {
                const ends = firstAndLast(data.weight.points);
                if (ends === null) return t("summary.month.noReadings");
                return ends.first === ends.last
                  ? t("summary.month.weightOne", {
                      value: formatWeight(ends.last.value),
                    })
                  : t("summary.month.weightChange", {
                      first: formatWeight(ends.first.value),
                      last: formatWeight(ends.last.value),
                    });
              })()}
              hint={(() => {
                const ends = firstAndLast(data.weight.points);
                return ends === null
                  ? undefined
                  : t("summary.month.weightDates", {
                      first: formatDayMonth(new Date(ends.first.at)),
                      last: formatDayMonth(new Date(ends.last.at)),
                    });
              })()}
            />
            <Metric
              label={t("summary.month.menu")}
              value={
                data.menu.items_planned === 0
                  ? t("summary.month.noMenu")
                  : t("summary.month.eaten", {
                      eaten: data.menu.items_eaten,
                      count: data.menu.items_planned,
                    })
              }
            />
          </MetricRow>
        )}
      </AsyncSection>
    </Section>
  );
}

/** `YYYY-MM-DD` → местная полночь того же дня, для подписи без сдвига суток. */
function isoToLocal(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(year, month - 1, day);
}
