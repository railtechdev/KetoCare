import {
  AsyncSection,
  Button,
  EmptyState,
  formatOccurredAt,
  MacroBar,
  RatioBadge,
  Section,
  WarningBanner,
} from "@ketocare/ui";
import { CalendarOff, ClipboardList, FileText, Lock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { AttachmentsPanel } from "../attachments/AttachmentsPanel";
import { CareTeamPanel } from "./CareTeamPanel";
import { FamilyPanel } from "./FamilyPanel";
import { MedicalProfileForm } from "./MedicalProfileForm";
import { formatIsoDate, formatTimestamp } from "./dates";
import { IntakeView } from "../intake/IntakeView";
import { useIntakeOptions } from "../intake/useIntake";
import { dayVerdict } from "../patients/dayVerdict";
import { usePatientOverview } from "../patients/overview";
import { useMedicalProfile } from "./doctorQueries";
import { LinesSkeleton } from "./skeletons";
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
        {overview.data !== undefined && <OverviewPanels data={overview.data} />}
      </AsyncSection>

      {/* Анкета — рядом с медицинским профилем: врачебная часть анамнеза и
          часть, заполненная семьёй, читаются вместе. Доступ к ней даёт сам
          доступ к пациенту, поэтому диетолог её тоже видит. */}
      <IntakeView patientId={patient.id} />

      {clinicalAllowed && <MedicalProfilePanel patientId={patient.id} />}

      {/* Документы — сразу после анкеты и профиля: анамнез и то, чем он
          подтверждён, читаются вместе. */}
      <AttachmentsPanel patientId={patient.id} />

      {/* Два ответа на один вопрос «с кем говорить»: кто ведёт ребёнка дома
          и кто ведёт его в клинике. Семья первой — к ней обращаются, когда
          дневники пусты, а это самый частый повод. */}
      <FamilyPanel patientId={patient.id} />

      <CareTeamPanel patientId={patient.id} />
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
      <Section title={t("summary.prescription.title")}>
        {prescription === null ? (
          <EmptyState
            icon={ClipboardList}
            title={t("summary.prescription.empty")}
            description={t("summary.prescription.emptyDescription")}
          />
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
                {t("summary.day.noPrescription")}
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
      </Section>
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
    <Section title={t("profile.title")}>
      {/* Правило четырёх состояний — общим компонентом (П15). 403 и
          «ещё не заполнен» — не сбои, а пустые состояния: предлагать врачу
          «Повторить» там, где повторять нечего, значит звать его в тупик. */}
      <AsyncSection
        loading={profile.isPending}
        skeleton={<LinesSkeleton label={t("profile.loading")} lines={4} />}
        error={
          profile.isError && !notFilled && !forbidden
            ? {
                title: t("profile.loadError"),
                description:
                  errorMessageOf(profile.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void profile.refetch()}
        isEmpty={forbidden}
        empty={
          <EmptyState
            icon={Lock}
            title={t("profile.forbidden")}
            description={t("profile.forbiddenDescription")}
          />
        }
      >
        {notFilled && (
          <EmptyState
            icon={FileText}
            title={t("profile.empty")}
            description={t("profile.emptyDescription")}
            action={
              <Button type="button" onClick={() => setEditing(true)}>
                {t("profile.fill")}
              </Button>
            }
          />
        )}

        {profile.data !== undefined && (
          <>
            <ProfileValues profile={profile.data} />
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => setEditing(true)}
            >
              {t("profile.edit")}
            </Button>
          </>
        )}
      </AsyncSection>
    </Section>
  );
}

function ProfileValues({ profile }: { profile: MedicalProfile }) {
  const { t } = useTranslation("doctor");
  const genetics = profile.genetics ?? null;

  // Число сменённых ПЭП хранится ссылкой на справочник, а не числом: шкала
  // задана медицинской командой («1-2», «3 и более»), и подписи берутся оттуда.
  // Выведенные из употребления варианты запрашиваются вместе с действующими —
  // иначе прежний ответ показался бы прочерком.
  const options = useIntakeOptions();
  const aedSwitchCount =
    options.data?.find((option) => option.id === profile.aed_switch_count_id)
      ?.name_ru ?? null;

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

      <dt className="text-muted-foreground">
        {t("profile.fields.aedSwitchCount")}
      </dt>
      <dd className="m-0">{aedSwitchCount ?? "—"}</dd>

      <dt className="text-muted-foreground">{t("profile.fields.updatedAt")}</dt>
      <dd className="m-0 tabular-nums">
        {formatTimestamp(profile.updated_at) ?? "—"}
      </dd>
    </dl>
  );
}
