import { ActionReason } from "@ketocare/ui";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { PrintButton } from "../../components/PrintButton";
import { PrintedSheets } from "../../components/print/PrintedSheets";
import { useDocumentFrame } from "../letterhead/useDocumentFrame";
import { usePatient } from "../patients/usePatient";
import { todayIso, weekStartOf } from "./dates";
import { useWeekQuery } from "./useWeek";
import { printableDays } from "./WeekGrid";
import { weekSheets } from "./weekSheets";

/**
 * Печать меню недели у семьи (ADR-0092, этап 6): прежде лист недели печатал
 * только специалист, и семья, собравшая неделю сама, не могла отдать её повару.
 * Те же листы, что у специалиста, плюс «что взвесить за неделю».
 */
export function FamilyWeekPrint({ patientId }: { patientId: string }) {
  const { t } = useTranslation("menu");
  const frame = useDocumentFrame();
  const patient = usePatient(patientId);
  const week = useWeekQuery(patientId, weekStartOf(todayIso()));
  const reasonId = useId();
  const empty =
    week.data !== undefined && printableDays(week.data).length === 0;

  return (
    <div className="flex flex-col items-start gap-1">
      <PrintButton
        label={t("weekPrint.button")}
        disabled={week.data === undefined || empty}
        describedBy={empty ? reasonId : undefined}
      >
        {week.data !== undefined && (
          <PrintedSheets
            frame={frame}
            sheets={weekSheets(t, week.data, patient.data?.full_name ?? "")}
          />
        )}
      </PrintButton>
      {empty && (
        <ActionReason id={reasonId}>{t("weekPrint.nothing")}</ActionReason>
      )}
    </div>
  );
}
