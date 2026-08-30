import { AsyncSection, EmptyState, Section } from "@ketocare/ui";
import { ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { formatIsoDate } from "../doctor/dates";
import { LinesSkeleton } from "../doctor/skeletons";
import {
  useAedDrugs,
  useIntakeOptions,
  usePatientIntake,
  type AedDrug,
  type IntakeOption,
  type PatientIntake,
} from "./useIntake";

/**
 * Анкета регистрации пациента — на чтение.
 *
 * Семья при заведении ребёнка отвечает на вопросы о приступах, лечении и
 * питании до начала терапии. Врачу эти ответы не показывались нигде: ручка
 * `GET /patients/{id}/intake` защищена только доступом к пациенту, то есть ему
 * открыта, а интерфейса чтения не было — данные видел лишь тот, кто их вводил.
 *
 * Это базовый анамнез и точка отсчёта: без частоты приступов ДО диеты оценить
 * её эффективность не с чем, и врач собирал тот же анамнез заново на приёме.
 *
 * Подписи вопросов берутся из словаря семьи (`intake`), а не заводятся своими:
 * это те же самые вопросы, и вторая копия однажды разошлась бы с первой —
 * врач и семья читали бы разные формулировки одного ответа.
 */
export function IntakeView({ patientId }: { patientId: string }) {
  const { t } = useTranslation("intake");
  const intake = usePatientIntake(patientId);
  const options = useIntakeOptions();
  const drugs = useAedDrugs();

  return (
    <Section title={t("title")} description={t("intro")} density="compact">
      <AsyncSection
        loading={intake.isPending || options.isPending || drugs.isPending}
        skeleton={<LinesSkeleton label={t("title")} lines={6} />}
        error={
          intake.isError
            ? {
                title: t("errors.load"),
                description:
                  errorMessageOf(intake.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void intake.refetch()}
        // Незаполненная анкета приходит как `null` (сервер отвечает 404) — это
        // «ещё не заполнена», а не сбой.
        isEmpty={intake.data === null}
        empty={
          <EmptyState
            icon={ClipboardList}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        }
      >
        {intake.data !== null && intake.data !== undefined && (
          <Answers
            intake={intake.data}
            options={options.data ?? []}
            drugs={drugs.data ?? []}
          />
        )}
      </AsyncSection>
    </Section>
  );
}

function Answers({
  intake,
  options,
  drugs,
}: {
  intake: PatientIntake;
  options: readonly IntakeOption[];
  drugs: readonly AedDrug[];
}) {
  const { t } = useTranslation("intake");

  // Ответ хранится ссылкой на справочник; выведенные из употребления варианты
  // приходят вместе с действующими, иначе прежний ответ семьи показался бы
  // прочерком.
  const named = (id: string | null) =>
    options.find((option) => option.id === id)?.name_ru ?? null;

  const yesNo = (value: boolean | null) =>
    value === null ? null : value ? t("yes") : t("no");

  const takenDrugs = drugs
    .filter((drug) => intake.current_aed_ids.includes(drug.id))
    .map((drug) => drug.name_ru);

  const groups = [
    {
      title: t("sections.seizures"),
      rows: [
        [t("fields.onsetAge"), named(intake.onset_age_id)],
        [
          t("fields.lastSeizureOn"),
          intake.last_seizure_on === null
            ? null
            : formatIsoDate(intake.last_seizure_on),
        ],
        [t("fields.frequency"), named(intake.seizure_frequency_id)],
        [t("fields.duration"), named(intake.seizure_duration_id)],
      ],
    },
    {
      title: t("sections.therapy"),
      rows: [
        [t("fields.developmentalDelay"), yesNo(intake.developmental_delay)],
        [
          t("fields.currentAed"),
          takenDrugs.length === 0 ? null : takenDrugs.join(", "),
        ],
      ],
    },
    {
      title: t("sections.meals"),
      rows: [
        [t("fields.mealsRegular"), yesNo(intake.meals_regular)],
        [t("fields.mealsPerDay"), named(intake.meals_per_day_id)],
      ],
    },
  ] as const;

  return (
    <div className="flex flex-col gap-block">
      {groups.map((group) => (
        <div key={group.title}>
          <h4 className="m-0 mb-field text-sm font-semibold">{group.title}</h4>
          <dl className="m-0 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr] sm:justify-start">
            {group.rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                {/* Неотвеченный вопрос показывается словами, а не прочерком:
                    прочерк читается как «нет приступов», а не как «не
                    спросили». */}
                <dd className="m-0">{value ?? t("notAnswered")}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
