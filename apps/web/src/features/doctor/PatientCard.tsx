import { Section, Tabs, TabsBar, TabsContent } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { useSectionTab } from "../../routes/useSectionTab";
import { useSession } from "../auth/useSession";
import { allergyNames } from "../patients/allergies";
import { MedicationsTab } from "./MedicationsTab";
import { NotesTab } from "./NotesTab";
import { PatientDiaryTab } from "./PatientDiaryTab";
import { PatientMenuTab } from "./PatientMenuTab";
import { PrescriptionTab } from "./PrescriptionTab";
import { SummaryTab } from "./SummaryTab";
import { ReportsView } from "../reports/ReportsView";
import { ageInMonths, formatIsoDate } from "./dates";
import { isDoctor, type Patient } from "./types";

/**
 * Вкладки карты — шесть, и это потолок канона (правило П29).
 *
 * «Лекарства» жили отдельной седьмой вкладкой и переехали к назначению: и то и
 * другое — то, что назначил врач, а разносить их значило требовать лишний клик
 * ради перехода между двумя половинами одного решения. Прежний адрес
 * `?tab=medications` теперь открывает сводку — внешних ссылок на него нет.
 */
const TABS = [
  "summary",
  "prescription",
  "menu",
  "diary",
  "reports",
  "notes",
] as const;

type TabKey = (typeof TABS)[number];

/**
 * Карта пациента: сводка, назначение, лекарства, дневники, отчёт, заметки
 * (раздел 8.3 ТЗ).
 *
 * Отчёт — здесь, а не отдельным разделом меню: у врача пациентов много, и
 * раздел верхнего уровня потребовал бы выбирать пациента заново. Экран отчёта
 * при этом общий с семьёй — числа в нём и в PDF обязаны совпадать.
 */
export function PatientCard({
  patient,
  onBack,
}: {
  patient: Patient;
  onBack: () => void;
}) {
  const { t } = useTranslation("doctor");
  const { session } = useSession();

  const allergies = allergyNames(patient, t("card.unknownProduct"));

  // Заметки сервер отдаёт только роли doctor; диетологу вкладка не показывается,
  // чтобы он не открывал заведомый 403. Права проверяет сервер.
  const clinicalAllowed = isDoctor(session?.role);
  const tabs: readonly TabKey[] = clinicalAllowed
    ? TABS
    : TABS.filter((tab) => tab !== "notes");

  // Вкладка — в адресе (правило П30): врач пересылает коллеге ссылку на
  // назначение пациента, а не «откройте карту и перейдите на вторую вкладку».
  // Список допустимых значений — уже отфильтрованный по роли: `?tab=notes` у
  // диетолога откроет сводку, а не заведомый 403.
  const [tab, setTab] = useSectionTab<TabKey>("tab", tabs, "summary");

  const months = ageInMonths(patient.birth_date, new Date());
  const birthDate = formatIsoDate(patient.birth_date);

  return (
    // Возврат со второго уровня — в шапке шаблона, а не рукописной кнопкой в
    // углу экрана (правило П2 канона).
    <PageLayout
      title={patient.full_name}
      onBack={onBack}
      backLabel={t("card.back")}
    >
      {/* Блок выделяется `Section`, а не `Card`: `Card` — карточка элемента
          списка, а это блок экрана (правило П23 канона). Заголовок скрыт —
          паспорт узнаётся по содержимому, а надпись «Пациент» под именем
          пациента была бы шумом; скринридер его при этом слышит. */}
      <Section title={t("card.passportTitle")} titleHidden density="compact">
        <dl className="m-0 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr] sm:justify-start">
          <dt className="text-muted-foreground">{t("card.birthDate")}</dt>
          <dd className="m-0 tabular-nums">
            {birthDate === null
              ? "—"
              : months === null
                ? birthDate
                : t("card.birthDateWithAge", {
                    date: birthDate,
                    age:
                      months < 24
                        ? t("age.months", { count: months })
                        : t("age.years", { count: Math.floor(months / 12) }),
                  })}
          </dd>

          <dt className="text-muted-foreground">{t("card.sex")}</dt>
          <dd className="m-0">{t(`card.sexValue.${patient.sex}`)}</dd>

          <dt className="text-muted-foreground">{t("card.height")}</dt>
          <dd className="m-0 tabular-nums">
            {patient.height_cm === null
              ? "—"
              : t("card.heightValue", { value: patient.height_cm })}
          </dd>

          <dt className="text-muted-foreground">{t("card.allergies")}</dt>
          <dd className="m-0">
            {/* Названия, а не идентификаторы: поле хранит ссылки на продукты
                вперемешку со свободными метками, и «dcf7df2c-349b…» в карте —
                это мусор в клинически значимой строке. */}
            {allergies.length === 0
              ? t("card.noAllergies")
              : allergies.join(", ")}
          </dd>

          {/* Заметки семьи. Родитель пишет их в разделе «Ребёнок» — про уход,
              непереносимости сверх списка аллергий, поведение. Читателя у поля
              не было ни одного: семья писала в пустоту. */}
          {patient.notes !== null && patient.notes.trim() !== "" && (
            <>
              <dt className="text-muted-foreground">{t("card.familyNotes")}</dt>
              <dd className="m-0 whitespace-pre-line">{patient.notes}</dd>
            </>
          )}
        </dl>
      </Section>

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
        <TabsBar
          label={t("card.tabsLabel")}
          items={tabs.map((value) => ({
            value,
            label: t(`card.tabs.${value}`),
          }))}
        />

        <TabsContent value="summary" className="pt-screen">
          <SummaryTab patient={patient} clinicalAllowed={clinicalAllowed} />
        </TabsContent>
        <TabsContent
          value="prescription"
          className="flex flex-col gap-block pt-screen"
        >
          <PrescriptionTab patientId={patient.id} />
          <MedicationsTab patientId={patient.id} />
        </TabsContent>
        <TabsContent value="menu" className="pt-screen">
          <PatientMenuTab patientId={patient.id} />
        </TabsContent>
        <TabsContent value="diary" className="pt-screen">
          <PatientDiaryTab patientId={patient.id} />
        </TabsContent>
        <TabsContent value="reports" className="pt-screen">
          <ReportsView patientId={patient.id} />
        </TabsContent>
        {clinicalAllowed && (
          <TabsContent value="notes" className="pt-screen">
            <NotesTab patientId={patient.id} />
          </TabsContent>
        )}
      </Tabs>
    </PageLayout>
  );
}
