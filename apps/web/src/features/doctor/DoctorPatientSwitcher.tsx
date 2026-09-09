import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PatientPicker } from "../patients/PatientPicker";
import { usePatient } from "../patients/usePatient";
import type { PatientView } from "./patientViews";

/**
 * Переход к другому пациенту, не выходя из раздела.
 *
 * Это и есть ответ на вопрос «а если пациентов пятьдесят». Приём идёт пациент
 * за пациентом, и путь «назад в реестр → найти строку → открыть карту → снова
 * открыть тот же раздел» повторяется весь день. Здесь он занимает одно нажатие
 * и три буквы, а открытый раздел сохраняется: врач, сверяющий дневники по
 * когорте, остаётся в дневниках.
 *
 * Сам поиск — в `PatientPicker`: тот же элемент управления передаёт пациенту
 * состав из общего калькулятора, и двух поисков по одной когорте здесь быть не
 * должно.
 */
export function DoctorPatientSwitcher({
  patientId,
  view,
}: {
  patientId: string;
  view: PatientView;
}) {
  const { t } = useTranslation("doctor");
  const navigate = useNavigate();
  const current = usePatient(patientId);

  return (
    <PatientPicker
      selectedId={patientId}
      label={t("workspace.switcher.label")}
      // Кнопка в шапке — не поле формы: рамка вокруг имени пациента читалась бы
      // как ввод. Имя здесь — то, где ты находишься.
      className="border-transparent shadow-none"
      trigger={
        <span className="font-medium">
          {current.data?.full_name ?? t("workspace.switcher.loading")}
        </span>
      }
      onSelect={(patient) => {
        void navigate({
          to: "/app/patients/$patientId/$view",
          params: { patientId: patient.id, view },
        });
      }}
    />
  );
}
