import {
  AsyncSection,
  Button,
  EmptyState,
  FactList,
  FormSheet,
  Section,
} from "@ketocare/ui";
import { ClipboardList, Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { LinesSkeleton } from "../doctor/skeletons";
import { IntakeForm } from "./IntakeForm";
import { formatLastSeizure } from "./lastSeizure";
import {
  useAedDrugs,
  useIntakeOptions,
  usePatientIntake,
  type AedDrug,
  type IntakeOption,
  type PatientIntake,
} from "./useIntake";
import { queryState } from "../../lib/queryState";

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
 *
 * **Специалист её и заполняет** (ADR-0046, аудит блокеров C11), когда
 * `editable`: у семьи из Telegram веб-кабинета нет, и анкета у неё оставалась
 * пустой, хотя сервер специалисту запись разрешал всегда. Форма та же, что у
 * семьи (`IntakeForm`), — в панели, а не своя копия: вопросы и правила ответа у
 * анкеты одни, кто бы её ни заполнял.
 */
export function IntakeView({
  patientId,
  childName,
  editable = false,
}: {
  patientId: string;
  /** Нужен форме для подтверждения «Анкета … сохранена». */
  childName?: string;
  editable?: boolean;
}) {
  const { t } = useTranslation("intake");
  const intake = usePatientIntake(patientId);
  const options = useIntakeOptions();
  const drugs = useAedDrugs();
  const [editing, setEditing] = useState(false);

  const filled = intake.data !== null && intake.data !== undefined;
  // Ответ анкеты — ссылка на справочник. Без справочника каждая строка
  // показалась бы «Не отвечено» — то есть неправдой о том, что семья ответила.
  const dictionariesFailed =
    (options.isError && options.data === undefined) ||
    (drugs.isError && drugs.data === undefined);

  return (
    <Section
      title={t("title")}
      description={t("intro")}
      density="compact"
      action={
        editable &&
        intake.isSuccess && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden="true" />
            {filled ? t("specialist.edit") : t("specialist.fill")}
          </Button>
        )
      }
    >
      <AsyncSection
        {...queryState(intake, options, drugs)}
        skeleton={<LinesSkeleton label={t("title")} lines={6} />}
        error={
          intake.isError
            ? {
                title: t("errors.load"),
                description:
                  errorMessageOf(intake.error) ?? t("common:errors.unexpected"),
              }
            : dictionariesFailed && filled
              ? {
                  title: t("errors.options"),
                  description:
                    errorMessageOf(options.error ?? drugs.error) ??
                    t("common:errors.unexpected"),
                }
              : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => {
          if (intake.isError) void intake.refetch();
          if (options.isError) void options.refetch();
          if (drugs.isError) void drugs.refetch();
        }}
        // Незаполненная анкета приходит как `null` (сервер отвечает 404) — это
        // «ещё не заполнена», а не сбой.
        isEmpty={intake.data == null || dictionariesFailed}
        empty={
          <EmptyState
            icon={ClipboardList}
            title={t("empty.title")}
            description={
              editable
                ? t("empty.specialistDescription")
                : t("empty.description")
            }
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

      {editable && (
        <FormSheet
          closeLabel={t("common:actions.close")}
          open={editing}
          onOpenChange={setEditing}
          title={t("specialist.sheetTitle")}
          description={t("specialist.sheetIntro")}
        >
          <IntakeForm
            patientId={patientId}
            childName={childName ?? ""}
            audience="specialist"
            onDone={() => setEditing(false)}
          />
        </FormSheet>
      )}
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
          // С той точностью, с какой помнят: «март 2026», а не «01.03.2026»
          // (вопрос 48, ADR-0049). «Не помню» — тоже ответ, не прочерк.
          intake.last_seizure_precision === "unknown"
            ? t("fields.lastSeizureUnknown")
            : formatLastSeizure(
                intake.last_seizure_on,
                intake.last_seizure_precision,
              ),
        ],
        [t("fields.frequency"), named(intake.seizure_frequency_id)],
        // Исходная частота — то, с чем сравнивают: эффект терапии измеряют
        // снижением ОТНОСИТЕЛЬНО неё (ответ 19). Поэтому строка стоит всегда,
        // когда про частоту вообще ответили, и у неё три разных смысла:
        //
        //   значение ≠ текущего — есть с чем сравнивать, видно изменение;
        //   значение = текущему — точка отсчёта есть, и частота не изменилась;
        //   пусто — точки отсчёта НЕТ (вопрос 49).
        //
        // Раньше вторые два состояния прятались одинаково, и врач не мог
        // отличить «не изменилось» от «сравнивать не с чем» — а это
        // противоположные вещи. Показать нечего только там, где про частоту не
        // отвечали НИ РАЗУ: тогда строка уходит в общее «Не отвечено».
        //
        // Условие смотрит на ОБА поля, а не на текущее. Анкета сохраняется
        // целиком, и неотмеченная в форме частота приходит как `null` при живой
        // исходной (сервер её бережёт — `test_baseline_survives_clearing…`).
        // Гейт по одной текущей прятал бы у такого ребёнка точку отсчёта, и
        // врач читал бы «данных нет» там, где они есть.
        //
        // Пустое состояние называет ФАКТ, а не причину: «не зафиксирована до
        // начала диеты». Причин у пустого поля несколько — про частоту впервые
        // ответили уже на терапии; анкету правили после старта, и перенос её не
        // добрал; назначение выписали задним числом, — и клиенту причина не
        // приходит вовсе. Назвать вероятную значило бы утверждать о ребёнке
        // больше, чем известно; тот же разбор был у `tolerance_gap`, где
        // причину в конце концов стал называть сервер.
        ...(intake.seizure_frequency_id === null &&
        intake.baseline_seizure_frequency_id === null
          ? []
          : ([
              [
                t("fields.baselineFrequency"),
                intake.baseline_seizure_frequency_id === null
                  ? t("fields.baselineNotRecorded")
                  : // Вариант записан, но исчез из справочника. Путь почти
                    // невозможен (внешний ключ стоит с `ON DELETE RESTRICT`, а
                    // выведенные варианты запрашиваются вместе с действующими),
                    // но без своей подписи строка сказала бы «Не отвечено» —
                    // то есть «точки отсчёта нет» про ребёнка, у которого она
                    // есть.
                    (named(intake.baseline_seizure_frequency_id) ??
                    t("fields.baselineUnnamed")),
              ],
            ] as const)),
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
    <div className="flex flex-col gap-section">
      {groups.map((group) => (
        <div key={group.title}>
          {/* h3, а не h4: блок анкеты — h2 (`Section`), и уровень между ними
              пропускать нельзя (П24). */}
          <h3 className="m-0 mb-field text-card-title font-semibold">
            {group.title}
          </h3>
          <FactList>
            {group.rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                {/* Неотвеченный вопрос показывается словами, а не прочерком:
                    прочерк читается как «нет приступов», а не как «не
                    спросили». */}
                <dd className="m-0">{value ?? t("notAnswered")}</dd>
              </div>
            ))}
          </FactList>
        </div>
      ))}
    </div>
  );
}
