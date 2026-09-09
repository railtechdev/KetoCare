import {
  AsyncSection,
  Button,
  EmptyState,
  Fact,
  FactList,
  FormSheet,
  Metric,
  MetricRow,
  Section,
  toast,
} from "@ketocare/ui";
import { FileText, Lock, Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { AttachmentsPanel } from "../attachments/AttachmentsPanel";
import { ChildForm } from "../child/ChildForm";
import { toChildUpdateBody } from "../child/childSchemas";
import { IntakeView } from "../intake/IntakeView";
import { useIntakeOptions } from "../intake/useIntake";
import { allergyNames } from "../patients/allergies";
import { useUpdateChildMutation } from "../patients/useChildren";
import { CareTeamPanel } from "./CareTeamPanel";
import { FamilyPanel } from "./FamilyPanel";
import { MedicalProfileForm } from "./MedicalProfileForm";
import { ageInMonths, formatIsoDate, formatTimestamp } from "./dates";
import { useMedicalProfile } from "./doctorQueries";
import { LinesSkeleton } from "./skeletons";
import type { MedicalProfile, Patient } from "./types";

/**
 * Раздел «Профиль»: кто этот пациент.
 *
 * Собран из того, что раньше лежало в сводке и над вкладками: паспорт, анкета
 * семьи, медицинский профиль, документы, семья и ведущие специалисты. Сводка от
 * этого перестала быть свалкой — там остались назначение, итоги дня и последние
 * замеры, то есть ответ на вопрос «что с ребёнком сейчас», ради которого её и
 * открывают. Анамнез отвечает на другой вопрос и нужен реже; за ним теперь
 * приходят, а не пролистывают его каждый раз.
 *
 * Паспорт стоял НАД вкладками и потому был виден на каждой из них. Заменить его
 * ничем нельзя было бы: врач обязан всё время видеть, чью карту читает. Теперь
 * это делает навигация рабочего места — имя и возраст стоят в её заголовке и
 * видны в любом разделе.
 */
export function PatientProfileView({
  patient,
  clinicalAllowed,
}: {
  patient: Patient;
  clinicalAllowed: boolean;
}) {
  const { t } = useTranslation("doctor");

  const allergies = allergyNames(patient, t("card.unknownProduct"));
  const [editOpen, setEditOpen] = useState(false);
  const update = useUpdateChildMutation(patient.id);

  const months = ageInMonths(patient.birth_date, new Date());
  const birthDate = formatIsoDate(patient.birth_date);

  return (
    <>
      {/* Блок выделяется `Section`, а не `Card`: `Card` — карточка элемента
          списка, а это блок экрана (правило П23 канона). */}
      <Section
        title={t("card.passportTitle")}
        /* Рост и аллергии правит и специалист, а не только семья: ребёнка
           взвешивают на приёме, а непереносимость всплывает в разговоре с
           врачом. Сервер это давно разрешает ведущему специалисту
           (`PATCH /patients/{id}` через `require_patient_access`) — интерфейса
           не было. */
        action={
          <Button
            type="button"
            variant="outline"
            className="min-h-touch"
            onClick={() => setEditOpen(true)}
          >
            <Pencil aria-hidden="true" />
            {t("card.edit")}
          </Button>
        }
      >
        {/* Пары «подпись — значение» рядом, а не столбиком: `MetricRow` кладёт
            столько столбцов, сколько влезает в САМ блок, и потому одинаково
            верен и во всю ширину, и в узкой колонке. */}
        <MetricRow min="wide" label={t("card.passportTitle")}>
          <Metric
            label={t("card.birthDate")}
            value={
              birthDate === null
                ? null
                : months === null
                  ? birthDate
                  : t("card.birthDateWithAge", {
                      date: birthDate,
                      age:
                        months < 24
                          ? t("age.months", { count: months })
                          : t("age.years", { count: Math.floor(months / 12) }),
                    })
            }
          />
          <Metric
            label={t("card.sex")}
            value={t(`card.sexValue.${patient.sex}`)}
          />
          <Metric
            label={t("card.height")}
            value={
              patient.height_cm === null
                ? null
                : t("card.heightValue", { value: patient.height_cm })
            }
          />
          {/* Названия, а не идентификаторы: поле хранит ссылки на продукты
              вперемешку со свободными метками, и «dcf7df2c-349b…» в карте —
              это мусор в клинически значимой строке. */}
          <Metric
            label={t("card.allergies")}
            value={
              allergies.length === 0
                ? t("card.noAllergies")
                : allergies.join(", ")
            }
          />
        </MetricRow>

        {/* Заметки семьи. Родитель пишет их в разделе «Ребёнок» — про уход,
            непереносимости сверх списка аллергий, поведение. Читателя у поля
            не было ни одного: семья писала в пустоту.

            Отдельной строкой под рядом, а не столбцом в нём: это свободный
            текст в несколько строк, и в ряду коротких фактов он растянул бы
            все столбцы по своей высоте. */}
        {patient.notes !== null && patient.notes.trim() !== "" && (
          <FactList>
            <Fact
              label={t("card.familyNotes")}
              value={patient.notes}
              multiline
            />
          </FactList>
        )}
      </Section>

      <FormSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        title={t("card.editTitle", { name: patient.full_name })}
      >
        {/* Та же форма, что у семьи: два разных набора полей для одного профиля
            однажды разошлись бы — и специалист правил бы не то, что видит
            родитель. */}
        <ChildForm
          child={patient}
          pending={update.isPending}
          error={update.error}
          onCancel={() => setEditOpen(false)}
          onSubmit={(values) => {
            update.mutate(toChildUpdateBody(values), {
              onSuccess: (saved) => {
                toast.success(t("card.saved", { name: saved.full_name }));
                setEditOpen(false);
              },
            });
          }}
        />
      </FormSheet>

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
    <FactList>
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
    </FactList>
  );
}
