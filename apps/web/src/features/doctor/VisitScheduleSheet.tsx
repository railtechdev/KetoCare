import { useTranslation } from "react-i18next";

import { formatIsoDate } from "./dates";
import type { ControlSchedule, ControlVisit } from "./therapyCourse";

/** Визиты, которые ещё предстоят, — по дате. */
export function upcomingVisits(
  visits: readonly ControlVisit[],
): ControlVisit[] {
  return visits
    .filter((visit) => !visit.completed_on)
    .sort((a, b) => (a.planned_on < b.planned_on ? -1 : 1));
}

/**
 * Лист «График визитов и анализов» для семьи (ADR-0092, этап 6): даты
 * контрольных визитов и что пройти к каждому — перечень клиники как есть
 * (вопросы 17 и 34).
 *
 * Перечня «еженедельно» на листе нет: клиника не сказала, сколько недель идёт
 * еженедельный контроль (`core/control_schedule.py`, TODO(med) к вопросу 34),
 * и семья прочла бы его как «сдавать кровь каждую неделю всё время диеты».
 * Врач видит оба перечня в карте.
 */
export function VisitScheduleSheet({
  schedule,
  visits,
}: {
  schedule: ControlSchedule;
  visits: readonly ControlVisit[];
}) {
  const { t } = useTranslation("doctor");

  return (
    <div className="flex flex-col gap-[5mm] text-[12pt] leading-snug">
      <div className="flex flex-col gap-[1.5mm]">
        <h1 className="m-0 text-[20pt] leading-tight font-bold">
          {t("course.sheet.title")}
        </h1>
        {schedule.therapy_started_on && (
          <p className="m-0 text-[#3d4556]">
            {t("course.sheet.started", {
              date: formatIsoDate(schedule.therapy_started_on),
            })}
          </p>
        )}
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-[#1a1f2e] text-left">
            <th scope="col" className="py-[1.5mm] pr-[3mm] font-semibold">
              {t("course.sheet.date")}
            </th>
            <th scope="col" className="py-[1.5mm] pr-[3mm] font-semibold">
              {t("course.sheet.visit")}
            </th>
            <th scope="col" className="py-[1.5mm] font-semibold">
              {t("course.sheet.labs")}
            </th>
          </tr>
        </thead>
        <tbody>
          {visits.map((visit) => (
            <tr
              key={visit.id}
              className="break-inside-avoid border-b border-[#c9ced8] align-top"
            >
              <td className="py-[2mm] pr-[3mm] font-semibold whitespace-nowrap">
                {formatIsoDate(visit.planned_on)}
              </td>
              <td className="py-[2mm] pr-[3mm]">
                {visit.month_offset != null
                  ? t("course.visits.month", { count: visit.month_offset })
                  : t("course.visits.manual")}
                {visit.purpose && (
                  <span className="block text-[10.5pt] text-[#4a5263]">
                    {t(`course.purpose.${visit.purpose}`)}
                  </span>
                )}
                {visit.note && (
                  <span className="block text-[10.5pt] text-[#4a5263]">
                    {visit.note}
                  </span>
                )}
              </td>
              <td className="py-[2mm]">
                {(visit.labs ?? []).length > 0
                  ? (visit.labs ?? []).join(", ")
                  : t("course.sheet.noLabs")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex gap-[3mm] rounded-[1.5mm] border border-[#8a93a3] bg-[#f2f4f8] px-[4mm] py-[3mm]">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#1a1f2e"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="mt-[0.5mm] shrink-0"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6" />
          <path d="M12 7.5h.01" />
        </svg>
        <p className="m-0">
          <b>{t("course.sheet.noteTitle")}</b> {t("course.sheet.note")}
        </p>
      </div>

      <p
        lang="uz"
        className="m-0 border-t border-[#c9ced8] pt-[3mm] text-[11pt]"
      >
        {t("course.sheet.uz")}
      </p>
    </div>
  );
}
