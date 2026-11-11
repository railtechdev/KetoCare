import { useTranslation } from "react-i18next";

import { PrintButton } from "../../components/PrintButton";
import { todayIso, weekStartOf } from "../menu/dates";
import { useWeekQuery } from "../menu/useWeek";
import { WeekPrint } from "../menu/WeekGrid";
import { usePatient } from "../patients/usePatient";
import { activePrescriptionOf, usePrescriptionHistory } from "./doctorQueries";
import { PrescriptionSheet } from "./PrescriptionPrint";

/**
 * Одна «Печать для семьи» в карте (`docs/AUDIT_ROLES_PATHS_2026-11.md`, этап 5):
 * лист назначения и меню текущей недели с граммовками. Раньше эти листы
 * печатались из двух разделов, и семья уходила с приёма с одним из них.
 */
export function FamilyPrintButton({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const patient = usePatient(patientId);
  const history = usePrescriptionHistory(patientId);
  const week = useWeekQuery(patientId, weekStartOf(todayIso()));
  const active = activePrescriptionOf(history.data);
  const name = patient.data?.full_name ?? "";
  const hasWeek = (week.data?.days ?? []).some(
    (day) => (day.menu?.items ?? []).length > 0,
  );

  return (
    <PrintButton
      label={t("familyPrint.button")}
      disabled={
        patient.data === undefined ||
        history.data === undefined ||
        week.data === undefined ||
        (active === null && !hasWeek)
      }
    >
      <div className="flex flex-col gap-6">
        {active !== null && (
          <PrescriptionSheet active={active} patientName={name} />
        )}
        {week.data !== undefined && hasWeek && (
          <div className="break-before-page">
            <WeekPrint week={week.data} patientName={name} />
          </div>
        )}
      </div>
    </PrintButton>
  );
}
