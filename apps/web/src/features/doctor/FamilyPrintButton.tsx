import { ActionReason } from "@ketocare/ui";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { PrintButton } from "../../components/PrintButton";
import { WordButton } from "../../components/WordButton";
import { wordFrame, type WordSection } from "../../lib/wordExport";
import { prescriptionWordSection } from "../print/prescriptionWord";
import { weekFileName, weekWordSections } from "../print/weekWord";
import { formatDayLabel, todayIso, weekStartOf } from "../menu/dates";
import { useWeekQuery } from "../menu/useWeek";
import { printableDays, WeekDayPrint } from "../menu/WeekGrid";
import { useDocumentFrame } from "../letterhead/useDocumentFrame";
import {
  PrintedSheets,
  type PrintedSheetSpec,
} from "../../components/print/PrintedSheets";
import { usePatient } from "../patients/usePatient";
import { activePrescriptionOf, usePrescriptionHistory } from "./doctorQueries";
import { usePrescriptionGoal } from "./PrescriptionGoalPreview";
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
export function FamilyPrintButton({
  patientId,
  weekStart,
}: {
  patientId: string;
  /** Неделя на листе; по умолчанию текущая. В разделе «Питание» — открытая в сетке. */
  weekStart?: string;
}) {
  const { t } = useTranslation("doctor");
  const patient = usePatient(patientId);
  const history = usePrescriptionHistory(patientId);
  const start = weekStart ?? weekStartOf(todayIso());
  const week = useWeekQuery(patientId, start);
  const active = activePrescriptionOf(history.data);
  const name = patient.data?.full_name ?? "";
  const hasWeek = (week.data?.days ?? []).some(
    (day) => (day.menu?.items ?? []).length > 0,
  );
  const reasonId = useId();
  const frame = useDocumentFrame();
  const loading =
    patient.data === undefined ||
    history.data === undefined ||
    week.data === undefined;
  // Пока данные едут, причины нет: кнопка ещё не решила, а не отказала.
  const reason =
    !loading && active === null && !hasWeek ? t("familyPrint.nothing") : null;
  // Тот же запрос, что у листа назначения: в Word он идёт той же таблицей
  // граммов. Без назначения запрос не уходит (ratio 0 — неполный ввод).
  const goal = usePrescriptionGoal({
    ratio: active?.ratio ?? 0,
    kcalPerDay: active?.kcal_per_day ?? 0,
    proteinG: active?.protein_g ?? 0,
    mealsPerDay: active?.meals_per_day ?? 0,
  });

  /** Назначение и каждый день недели — по листу (ADR-0092). */
  function printSheets(): PrintedSheetSpec[] {
    const sheets: PrintedSheetSpec[] = [];
    if (active !== null) {
      sheets.push({
        key: "prescription",
        title: t("familyPrint.sheet.prescription"),
        aside: name,
        code: "KC-RX-1",
        content: <PrescriptionSheet active={active} patientName={name} />,
      });
    }
    if (week.data !== undefined) {
      for (const day of printableDays(week.data)) {
        sheets.push({
          key: day.date,
          title: t("familyPrint.sheet.day", { day: formatDayLabel(day.date) }),
          aside: name,
          code: "KC-WEEK-1",
          content: <WeekDayPrint day={day} patientName={name} />,
        });
      }
    }
    return sheets;
  }

  function wordSections(): WordSection[] {
    const sections: WordSection[] = [];
    if (active !== null) {
      sections.push(prescriptionWordSection(t, active, name, goal.data));
    }
    if (week.data !== undefined && hasWeek) {
      sections.push(...weekWordSections(t, week.data, name));
    }
    return sections;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <PrintButton
        label={t("familyPrint.button")}
        disabled={loading || reason !== null}
        describedBy={reason === null ? undefined : reasonId}
      >
        <PrintedSheets frame={frame} sheets={printSheets()} />
      </PrintButton>
      <WordButton
        label={t("common:word.button")}
        disabled={loading || reason !== null}
        describedBy={reason === null ? undefined : reasonId}
        fileName={weekFileName(t("familyPrint.wordFile"), name, start)}
        build={() => ({
          title: t("familyPrint.wordTitle", { name }),
          sections: wordSections(),
          frame: wordFrame(t, frame, {
            title: t("familyPrint.sheet.word"),
            aside: name,
            code: "KC-FAMILY-1",
          }),
        })}
      />
      {reason !== null && <ActionReason id={reasonId}>{reason}</ActionReason>}
    </div>
  );
}
