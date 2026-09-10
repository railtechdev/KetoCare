import {
  AsyncSection,
  Button,
  EmptyState,
  FactList,
  formatOccurredAt,
  MacroBar,
  RatioBadge,
  Section,
  WarningBanner,
} from "@ketocare/ui";
import { CalendarOff, ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { formatIsoDate } from "./dates";
import { dayVerdict, toleranceGapKey } from "../patients/dayVerdict";
import { usePatientOverview } from "../patients/overview";
import { PatientViewLink } from "./PatientViewLink";
import { LinesSkeleton } from "./skeletons";
import type { Patient, PatientOverview } from "./types";

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
 */
export function SummaryTab({ patient }: { patient: Patient }) {
  const { t } = useTranslation("doctor");
  const overview = usePatientOverview(patient.id);

  return (
    <div className="flex flex-col gap-block">
      {/* Четыре состояния — общим компонентом. Рукописная цепочка прятала
          уже загруженную сводку за сообщением об ошибке: TanStack Query при
          неудачном ОБНОВЛЕНИИ сохраняет прежний ответ и одновременно
          переводит запрос в состояние ошибки (правило П15 канона). */}
      <AsyncSection
        loading={overview.isPending}
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
  const day = data.day ?? null;
  const tolerance = day?.tolerance ?? null;

  // Что показывать предупреждением, а что набором, решает patients/dayVerdict —
  // одинаково для главной родителя, меню и этой карты.
  const verdict = dayVerdict(tolerance, day?.tolerance_gap ?? null);

  return (
    <>
      <Section title={t("summary.prescription.title")}>
        {prescription === null ? (
          <EmptyState
            icon={ClipboardList}
            title={t("summary.prescription.empty")}
            description={t("summary.prescription.emptyDescription")}
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
              {t("units.kcalPerDay", { value: prescription.kcal_per_day })}
            </dd>

            <dt className="text-muted-foreground">{t("fields.protein")}</dt>
            <dd className="m-0 tabular-nums">
              {t("units.gramsPerDay", { value: prescription.protein_g })}
            </dd>

            <dt className="text-muted-foreground">{t("fields.carbsLimit")}</dt>
            <dd className="m-0 tabular-nums">
              {t("units.gramsPerDay", { value: prescription.carbs_limit_g })}
            </dd>

            <dt className="text-muted-foreground">{t("fields.meals")}</dt>
            <dd className="m-0 tabular-nums">{prescription.meals_per_day}</dd>

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
      </Section>

      <Section title={t("summary.day.title")}>
        {day === null ? (
          <EmptyState
            icon={CalendarOff}
            title={t("summary.day.empty")}
            description={t("summary.day.emptyDescription")}
          />
        ) : (
          <div className="flex flex-col gap-block">
            <div className="flex flex-wrap items-center gap-block">
              {/* Вердикт о соответствии приходит от сервера: допуски — константы
                  расчётного ядра, на клиенте их копии нет (правило 2 CLAUDE.md). */}
              <RatioBadge
                ratio={day.totals.ratio}
                withinTolerance={tolerance?.ratio_within_tolerance}
              />
              <span className="tabular-nums">
                {t("units.kcal", { value: day.totals.kcal.toFixed(0) })}
              </span>
            </div>

            <MacroBar
              fatG={day.totals.fat}
              proteinG={day.totals.protein}
              carbsG={day.totals.carbs}
            />

            {verdict.unavailable ? (
              <p className="m-0 text-sm text-muted-foreground">
                {t(`summary.day.${toleranceGapKey(verdict.unavailableReason)}`)}
              </p>
            ) : verdict.ratioOffTolerance ? (
              <WarningBanner level="warning" title={t("summary.day.offTitle")}>
                {t("summary.day.offRatio")}
              </WarningBanner>
            ) : (
              <p role="status" className="m-0 text-sm text-success">
                {t("summary.day.within")}
              </p>
            )}

            {verdict.kcalBelowTarget && (
              <p className="m-0 text-sm text-muted-foreground">
                {t("summary.day.kcalBelowTarget", {
                  value: day.totals.kcal.toFixed(0),
                  target: prescription?.kcal_per_day ?? 0,
                })}
              </p>
            )}

            {day.engine_version && (
              <p className="m-0 text-xs text-muted-foreground">
                {t("units.engineVersion", { version: day.engine_version })}
              </p>
            )}
          </div>
        )}
      </Section>

      <Section title={t("summary.readings.title")}>
        <FactList>
          <dt className="text-muted-foreground">
            {t("summary.readings.ketone")}
          </dt>
          <dd className="m-0">
            {data.last_ketone == null
              ? t("summary.readings.noKetone")
              : t("summary.readings.ketoneValue", {
                  value: data.last_ketone.value,
                  method: t(
                    `summary.readings.method.${data.last_ketone.method}`,
                  ),
                  at: formatOccurredAt(new Date(data.last_ketone.occurred_at)),
                })}
          </dd>

          <dt className="text-muted-foreground">
            {t("summary.readings.weight")}
          </dt>
          <dd className="m-0">
            {data.last_weight == null
              ? t("summary.readings.noWeight")
              : t("summary.readings.weightValue", {
                  value: data.last_weight.weight_kg,
                  at: formatOccurredAt(new Date(data.last_weight.occurred_at)),
                })}
          </dd>

          <dt className="text-muted-foreground">
            {t("summary.readings.seizures")}
          </dt>
          <dd className="m-0 tabular-nums">
            {t("summary.readings.seizuresValue", {
              count: data.seizures_today.count,
              entries: data.seizures_today.entries,
            })}
          </dd>
        </FactList>
      </Section>
    </>
  );
}
