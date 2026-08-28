import {
  MacroBar,
  RatioBadge,
  WarningBanner,
  formatOccurredAt,
} from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { Panel } from "../home/Panel";
import { MedicalProfileForm } from "./MedicalProfileForm";
import { formatIsoDate, formatTimestamp } from "./dates";
import { dayVerdict } from "../patients/dayVerdict";
import { usePatientOverview } from "../patients/overview";
import { useMedicalProfile } from "./doctorQueries";
import type { MedicalProfile, Patient, PatientOverview } from "./types";

/**
 * Сводка карты пациента.
 *
 * Клиническая часть экрана приходит одним запросом `/patients/{id}/overview`:
 * назначение, итоги дня против него, последние замеры и приступы за сегодня
 * собраны сервером на один момент времени. Медицинский профиль — отдельная
 * ручка, доступная только врачу.
 */
export function SummaryTab({
  patient,
  clinicalAllowed,
}: {
  patient: Patient;
  clinicalAllowed: boolean;
}) {
  const { t } = useTranslation("doctor");
  const overview = usePatientOverview(patient.id);

  return (
    <div className="flex flex-col gap-4">
      {overview.isPending && (
        <p role="status" className="m-0 text-muted-foreground">
          {t("summary.loading")}
        </p>
      )}

      {overview.isError && (
        <FormError>
          {errorMessageOf(overview.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {overview.data !== undefined && <OverviewPanels data={overview.data} />}

      {clinicalAllowed && <MedicalProfilePanel patientId={patient.id} />}
    </div>
  );
}

function OverviewPanels({ data }: { data: PatientOverview }) {
  const { t } = useTranslation("doctor");

  const prescription = data.prescription ?? null;
  const day = data.day ?? null;
  const tolerance = day?.tolerance ?? null;

  // Что показывать предупреждением, а что набором, решает patients/dayVerdict —
  // одинаково для главной родителя, меню и этой карты.
  const verdict = dayVerdict(tolerance);

  return (
    <>
      <Panel title={t("summary.prescription.title")}>
        {prescription === null ? (
          <p className="m-0 text-muted-foreground">
            {t("summary.prescription.empty")}
          </p>
        ) : (
          <dl className="m-0 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr] sm:justify-start">
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
          </dl>
        )}
      </Panel>

      <Panel title={t("summary.day.title")}>
        {day === null ? (
          <p className="m-0 text-muted-foreground">{t("summary.day.empty")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-4">
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
              className="mt-4"
              fatG={day.totals.fat}
              proteinG={day.totals.protein}
              carbsG={day.totals.carbs}
            />

            {verdict.unavailable ? (
              <p className="m-0 mt-4 text-sm text-muted-foreground">
                {t("summary.day.noPrescription")}
              </p>
            ) : verdict.ratioOffTolerance ? (
              <WarningBanner
                className="mt-4"
                level="warning"
                title={t("summary.day.offTitle")}
              >
                {t("summary.day.offRatio")}
              </WarningBanner>
            ) : (
              <p role="status" className="m-0 mt-4 text-sm text-success">
                {t("summary.day.within")}
              </p>
            )}

            {verdict.kcalBelowTarget && (
              <p className="m-0 mt-3 text-sm text-muted-foreground">
                {t("summary.day.kcalBelowTarget", {
                  value: day.totals.kcal.toFixed(0),
                  target: prescription?.kcal_per_day ?? 0,
                })}
              </p>
            )}

            {day.engine_version && (
              <p className="m-0 mt-3 text-xs text-muted-foreground">
                {t("units.engineVersion", { version: day.engine_version })}
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel title={t("summary.readings.title")}>
        <dl className="m-0 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr] sm:justify-start">
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
        </dl>
      </Panel>
    </>
  );
}

function MedicalProfilePanel({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const [editing, setEditing] = useState(false);

  const profile = useMedicalProfile(patientId, true);

  // Незаполненный профиль сервер отдаёт как 404 — это не сбой, а состояние
  // «ещё не заполнен», и показывать его как ошибку нельзя.
  const notFilled = errorCodeOf(profile.error) === "not_found";
  const forbidden = errorCodeOf(profile.error) === "forbidden";

  if (editing) {
    return (
      <MedicalProfileForm
        patientId={patientId}
        profile={profile.data ?? null}
        onDone={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <Panel title={t("profile.title")}>
      {profile.isPending && (
        <p role="status" className="m-0 text-muted-foreground">
          {t("profile.loading")}
        </p>
      )}

      {forbidden && (
        <p className="m-0 text-muted-foreground">{t("profile.forbidden")}</p>
      )}

      {profile.isError && !notFilled && !forbidden && (
        <FormError>
          {errorMessageOf(profile.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {notFilled && (
        <p className="m-0 text-muted-foreground">{t("profile.empty")}</p>
      )}

      {profile.data !== undefined && <ProfileValues profile={profile.data} />}

      {!forbidden && !profile.isPending && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-4 min-h-touch rounded-lg border border-border px-4 text-sm font-semibold text-primary"
        >
          {notFilled ? t("profile.fill") : t("profile.edit")}
        </button>
      )}
    </Panel>
  );
}

function ProfileValues({ profile }: { profile: MedicalProfile }) {
  const { t } = useTranslation("doctor");
  const genetics = profile.genetics ?? null;

  return (
    <dl className="m-0 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr] sm:justify-start">
      <dt className="text-muted-foreground">{t("profile.fields.diagnosis")}</dt>
      <dd className="m-0">{profile.diagnosis ?? "—"}</dd>

      <dt className="text-muted-foreground">
        {t("profile.fields.epilepsyType")}
      </dt>
      <dd className="m-0">{profile.epilepsy_type ?? "—"}</dd>

      <dt className="text-muted-foreground">{t("profile.fields.onset")}</dt>
      <dd className="m-0 tabular-nums">
        {profile.onset_age_months === null
          ? "—"
          : t("age.months", { count: profile.onset_age_months })}
      </dd>

      <dt className="text-muted-foreground">{t("profile.fields.genetics")}</dt>
      <dd className="m-0">
        {genetics === null ||
        (genetics.gene == null &&
          genetics.variant == null &&
          genetics.interpretation == null)
          ? "—"
          : [genetics.gene, genetics.variant, genetics.interpretation]
              .filter((part): part is string => part != null && part !== "")
              .join(" · ")}
      </dd>

      <dt className="text-muted-foreground">
        {t("profile.fields.comorbidities")}
      </dt>
      <dd className="m-0">{profile.comorbidities ?? "—"}</dd>

      <dt className="text-muted-foreground">{t("profile.fields.updatedAt")}</dt>
      <dd className="m-0 tabular-nums">
        {formatTimestamp(profile.updated_at) ?? "—"}
      </dd>
    </dl>
  );
}
