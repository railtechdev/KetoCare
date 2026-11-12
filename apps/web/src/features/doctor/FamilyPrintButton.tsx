import { ActionReason } from "@ketocare/ui";
import { useId } from "react";
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
 *
 * Название говорит, что будет на листе («Печать: назначение и меню недели»), а
 * недоступная кнопка называет причину рядом (правило П44): прежде она гасла
 * молча, и врач решал, что печать сломана.
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
  const reasonId = useId();
  const loading =
    patient.data === undefined ||
    history.data === undefined ||
    week.data === undefined;
  // Пока данные едут, причины нет: кнопка ещё не решила, а не отказала.
  const reason =
    !loading && active === null && !hasWeek ? t("familyPrint.nothing") : null;

  return (
    <div className="flex flex-col items-end gap-1">
      <PrintButton
        label={t("familyPrint.button")}
        disabled={loading || reason !== null}
        describedBy={reason === null ? undefined : reasonId}
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
      {reason !== null && <ActionReason id={reasonId}>{reason}</ActionReason>}
    </div>
  );
}
