import {
  Button,
  FormSheet,
  Metric,
  MetricRow,
  Section,
  Tabs,
  TabsBar,
  TabsContent,
  toast,
} from "@ketocare/ui";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { useSectionTab } from "../../routes/useSectionTab";
import { useSession } from "../auth/useSession";
import { ChildForm } from "../child/ChildForm";
import { toChildUpdateBody } from "../child/childSchemas";
import { allergyNames } from "../patients/allergies";
import { useUpdateChildMutation } from "../patients/useChildren";
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
  const [editOpen, setEditOpen] = useState(false);
  const update = useUpdateChildMutation(patient.id);

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
      // Карта — рабочая страница: под ней шесть вкладок с таблицами и графиками,
      // и предел 72rem оставлял на мониторе 1920 четверть окна пустой.
      width="wide"
      // Плотность объявляется один раз на экран и наследуется блоками вкладок,
      // а не проставляется в каждом (правило П26 канона).
      density="compact"
    >
      {/* Блок выделяется `Section`, а не `Card`: `Card` — карточка элемента
          списка, а это блок экрана (правило П23 канона). Заголовок скрыт —
          паспорт узнаётся по содержимому, а надпись «Пациент» под именем
          пациента была бы шумом; скринридер его при этом слышит. */}
      <Section
        title={t("card.passportTitle")}
        titleHidden
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
        {/* Паспорт — рядом, а не столбиком. Пары «подпись — значение» шли
            двумя столбцами на всю ширину карты: четыре коротких факта занимали
            четыре строки и отодвигали вкладки вниз, а справа оставалось пусто.
            `MetricRow` кладёт столько столбцов, сколько влезает в САМ блок, —
            и потому одинаково верен и в карте, и в узкой колонке. */}
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
          <div className="text-sm">
            <p className="m-0 text-muted-foreground">{t("card.familyNotes")}</p>
            <p className="m-0 whitespace-pre-line">{patient.notes}</p>
          </div>
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

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
        <TabsBar
          label={t("card.tabsLabel")}
          items={tabs.map((value) => ({
            value,
            label: t(`card.tabs.${value}`),
          }))}
        />

        <TabsContent value="summary" className="pt-screen">
          <SummaryTab
            patient={patient}
            clinicalAllowed={clinicalAllowed}
            onOpenPrescriptions={() => setTab("prescription")}
          />
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
