import * as Tabs from "@radix-ui/react-tabs";
import { useTranslation } from "react-i18next";

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
    <section className="flex flex-col gap-6">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="min-h-touch rounded-lg border border-border px-3 text-sm font-semibold"
        >
          {t("card.back")}
        </button>
      </div>

      <header className="rounded-xl bg-card p-4 text-foreground shadow-kc">
        <h1 className="m-0 text-xl font-semibold">{patient.full_name}</h1>

        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr] sm:justify-start">
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
      </header>

      <Tabs.Root defaultValue="summary">
        <Tabs.List
          aria-label={t("card.tabsLabel")}
          className="flex flex-wrap gap-2 border-b border-border"
        >
          {tabs.map((tab) => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              className="min-h-touch px-4 text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:font-semibold"
            >
              {t(`card.tabs.${tab}`)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="summary" className="pt-6">
          <SummaryTab patient={patient} clinicalAllowed={clinicalAllowed} />
        </Tabs.Content>
        <Tabs.Content value="prescription" className="pt-6">
          <PrescriptionTab patientId={patient.id} />
        </Tabs.Content>
        <Tabs.Content value="medications" className="pt-6">
          <MedicationsTab patientId={patient.id} />
        </Tabs.Content>
        <Tabs.Content value="diary" className="pt-6">
          <PatientDiaryTab patientId={patient.id} />
        </Tabs.Content>
        {clinicalAllowed && (
          <Tabs.Content value="notes" className="pt-6">
            <NotesTab patientId={patient.id} />
          </Tabs.Content>
        )}
      </Tabs.Root>
    </section>
  );
}
