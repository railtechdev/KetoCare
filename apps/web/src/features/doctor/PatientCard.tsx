import {
  Card,
  CardContent,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { useSession } from "../auth/useSession";
import { MedicationsTab } from "./MedicationsTab";
import { NotesTab } from "./NotesTab";
import { PatientDiaryTab } from "./PatientDiaryTab";
import { PrescriptionTab } from "./PrescriptionTab";
import { SummaryTab } from "./SummaryTab";
import { ageInMonths, formatIsoDate } from "./dates";
import { isDoctor, type Patient } from "./types";

const TABS = [
  "summary",
  "prescription",
  "medications",
  "diary",
  "notes",
] as const;

type TabKey = (typeof TABS)[number];

/** Карта пациента: сводка, назначение, лекарства, дневники, заметки (раздел 8.3 ТЗ). */
export function PatientCard({
  patient,
  onBack,
}: {
  patient: Patient;
  onBack: () => void;
}) {
  const { t } = useTranslation("doctor");
  const { session } = useSession();

  // Заметки сервер отдаёт только роли doctor; диетологу вкладка не показывается,
  // чтобы он не открывал заведомый 403. Права проверяет сервер.
  const clinicalAllowed = isDoctor(session?.role);
  const tabs: readonly TabKey[] = clinicalAllowed
    ? TABS
    : TABS.filter((tab) => tab !== "notes");

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
      <Card>
        <CardContent>
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
              {patient.allergies.length === 0
                ? t("card.noAllergies")
                : patient.allergies.join(", ")}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Tabs defaultValue="summary">
        {/* Пять вкладок в 360 px не помещаются в строку, поэтому список
            переносится, а не уезжает в горизонтальный скролл. */}
        <TabsList
          aria-label={t("card.tabsLabel")}
          variant="line"
          className="w-full flex-wrap justify-start gap-1 border-b border-border group-data-[orientation=horizontal]/tabs:h-auto"
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className="min-h-touch flex-none px-4"
            >
              {t(`card.tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="summary" className="pt-screen">
          <SummaryTab patient={patient} clinicalAllowed={clinicalAllowed} />
        </TabsContent>
        <TabsContent value="prescription" className="pt-screen">
          <PrescriptionTab patientId={patient.id} />
        </TabsContent>
        <TabsContent value="medications" className="pt-screen">
          <MedicationsTab patientId={patient.id} />
        </TabsContent>
        <TabsContent value="diary" className="pt-screen">
          <PatientDiaryTab patientId={patient.id} />
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
