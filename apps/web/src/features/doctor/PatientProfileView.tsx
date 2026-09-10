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
  formatOccurredAt,
  toast,
  formatWeight,
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
import { todayIso } from "../menu/dates";
import { allergyNames } from "../patients/allergies";
import { usePatientOverview } from "../patients/overview";
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
  clinicalEditable,
}: {
  patient: Patient;
  /** Кому анамнез виден: врач и диетолог (`GET /medical-profile`). */
  clinicalAllowed: boolean;
  /** Кто его правит: только врач (`PUT /medical-profile`). */
  clinicalEditable: boolean;
}) {
  const { t } = useTranslation("doctor");

  const allergies = allergyNames(patient, t("card.unknownProduct"));
  // Вес — не поле карточки, а последний замер из дневника.
  //
  // Заказчица просила «добавить вес рядом с ростом». Завести второе поле было
  // нельзя: вес уже есть серией `weight_logs`, по ней строится динамика и по
  // ней будут считаться z-баллы. Поле в профиле стало бы вторым источником
  // одного числа, и однажды они разошлись бы молча — как уже случилось с
  // ростом (`patients.height_cm` и `weight_logs.height_cm` живут параллельно).
  //
  // Запрос тот же, что у сводки, и ключ у них общий: карта пациента почти
  // всегда открывает сводку первой, поэтому здесь берётся уже готовый ответ.
  const overview = usePatientOverview(patient.id);
  const lastWeight = overview.data?.last_weight ?? null;

  // Диагноз — в паспорте, а не только в медицинском профиле ниже.
  //
  // Просьба заказчицы: врач принимает решения, глядя на паспорт, а за
  // диагнозом приходилось прокручивать экран до отдельного блока. Запрос тот
  // же, что у блока ниже, и ключ у них общий.
  //
  // Строка видна ведущему специалисту — врачу и диетологу (ответ клиники
  // 09.09.2026, вопрос 7: «Диетолог может видеть диагноз… но не вносить
  // изменения»). Право открывает СЕРВЕР, `clinicalAllowed` только повторяет
  // его границу: показывать раздел, который ответит 403, — тупик, а прятать то,
  // что сервер отдаёт, — не безопасность (правило 5 CLAUDE.md).
  const medicalProfile = useMedicalProfile(patient.id, clinicalAllowed);
  const diagnosis = medicalProfile.data?.diagnosis ?? null;
  // Незаполненный профиль сервер отдаёт как 404 — это состояние, а не сбой.
  const profileNotFilled =
    medicalProfile.isSuccess ||
    errorCodeOf(medicalProfile.error) === "not_found";
  const profileFailed = medicalProfile.isError && !profileNotFilled;
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
          {/* Дата замера стоит рядом с числом: вес ребёнка на кетодиете —
              величина, которая быстро устаревает, и «18,2 кг» без даты не
              говорит, вчерашнее это или трёхмесячной давности.
              «Замеров нет» — утверждение о ребёнке, и говорить его можно
              только тогда, когда сервер ответил (правило П15 канона): при
              сбое сети `isPending` уже ложь, а данных всё ещё нет. */}
          <Metric
            label={t("card.weight")}
            value={
              lastWeight !== null
                ? t("card.weightValue", {
                    value: formatWeight(lastWeight.weight_kg),
                    // `formatWeight` — одна функция на все пять мест, где
                    // виден вес: у семьи, у врача и в Mini App. Один и тот же
                    // замер, показанный по-разному, читается как два.
                    at: formatOccurredAt(new Date(lastWeight.occurred_at)),
                  })
                : overview.isSuccess
                  ? t("card.noWeight")
                  : null
            }
            hint={overview.isError ? t("card.loadFailed") : undefined}
          />
          {clinicalAllowed && (
            <Metric
              label={t("card.diagnosis")}
              value={
                diagnosis !== null && diagnosis.trim() !== ""
                  ? diagnosis
                  : // 404 здесь законен: «профиль ещё не заполнен». Любая
                    // другая ошибка — сбой, и выдавать его за незаполненный
                    // профиль нельзя.
                    profileNotFilled
                    ? t("card.noDiagnosis")
                    : null
              }
              hint={profileFailed ? t("card.loadFailed") : undefined}
            />
          )}
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

      {clinicalAllowed && (
        <MedicalProfilePanel
          patientId={patient.id}
          editable={clinicalEditable}
        />
      )}

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

function MedicalProfilePanel({
  patientId,
  editable,
}: {
  patientId: string;
  editable: boolean;
}) {
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
        {/* Кнопки правки — только тому, кому сервер разрешает `PUT`. Диетолог
            анамнез читает, но не правит (ответ 7), и кнопка, ведущая в 403, —
            тот же тупик, что пункт меню без экрана (правило П3 канона).
            Пустой профиль ему объясняется словами: «ещё не заполнен, заполняет
            врач» — иначе пустой блок читается как сбой. */}
        {notFilled && (
          <EmptyState
            icon={FileText}
            title={t("profile.empty")}
            description={
              editable
                ? t("profile.emptyDescription")
                : t("profile.emptyForReader")
            }
            action={
              editable ? (
                <Button type="button" onClick={() => setEditing(true)}>
                  {t("profile.fill")}
                </Button>
              ) : undefined
            }
          />
        )}

        {profile.data !== undefined && (
          <>
            <ProfileValues profile={profile.data} />
            {editable && (
              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={() => setEditing(true)}
              >
                {t("profile.edit")}
              </Button>
            )}
          </>
        )}
      </AsyncSection>
    </Section>
  );
}

function ProfileValues({ profile }: { profile: MedicalProfile }) {
  const { t } = useTranslation("doctor");
  const genetics = profile.genetics ?? null;

  const therapyStart =
    profile.therapy_started_on === null
      ? null
      : formatIsoDate(profile.therapy_started_on);
  // Сравнение по календарной дате, а не по моменту: «сегодня» началом уже
  // считается (то же строгое сравнение, что в правиле про исходную частоту).
  //
  // `todayIso()`, а не `toISOString()`: тот переводит в UTC, и в поясе клиники
  // (UTC+5) с полуночи до пяти утра дня старта карта писала бы «ещё не
  // началась» про терапию, которую сервер уже считает начатой, — то есть
  // подпись противоречила бы ровно тому правилу, которое поясняет.
  const therapyStartIsAhead =
    profile.therapy_started_on !== null &&
    profile.therapy_started_on > todayIso();

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

      {/* Дата начала терапии — не «ещё одно поле анамнеза»: от неё считаются
          контрольные визиты и точка отсчёта для оценки эффекта. Пустая она
          говорится словами, а не прочерком: прочерк здесь читался бы как
          «терапии не было», а на деле это «дата не внесена, и началом пока
          считается первое назначение». */}
      <dt className="text-muted-foreground">
        {t("profile.fields.therapyStartedOn")}
      </dt>
      <dd className="m-0 tabular-nums">
        {profile.therapy_started_on === null
          ? t("profile.fields.therapyStartNotSet")
          : therapyStart === null
            ? "—"
            : // Будущая дата подписывается словами. Она законна — «диету
              // начинаем с понедельника», — но ровно так же выглядит опечатка в
              // году: «2062» вместо «2026» это одна цифра, и никакой проверкой
              // её не отличить от намерения. Единственное, что можно сделать
              // честно, — показать врачу, что он ввёл: строка «ещё не началась»
              // рядом с 2062 годом читается сразу.
              t(
                therapyStartIsAhead
                  ? "profile.fields.therapyStartAhead"
                  : "profile.fields.therapyStartOn",
                { date: therapyStart },
              )}
      </dd>

      <dt className="text-muted-foreground">{t("profile.fields.updatedAt")}</dt>
      <dd className="m-0 tabular-nums">
        {formatTimestamp(profile.updated_at) ?? "—"}
      </dd>
    </FactList>
  );
}
