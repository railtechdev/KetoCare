import {
  medicationTerm,
  scheduledMedications as scheduledFromKit,
} from "@ketocare/ui";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { formatIsoDate } from "./dates";
import {
  describeFrequency,
  type MedicationFrequency,
} from "./medicationFrequency";
import type { Medication } from "./types";

/**
 * Сколько строк отметок в сутки даёт кратность. Это буквальный смысл кода
 * (HL7 FHIR `TimingAbbreviation`, ADR-0033), а не время приёма: «2 раза в
 * сутки» — две клетки на день, а утром и вечером или нет — пишет врач в
 * уточнении, и лист его печатает словами.
 */
const INTAKES_PER_DAY: Record<MedicationFrequency, number> = {
  once_daily: 1,
  twice_daily: 2,
  three_times_daily: 3,
  four_times_daily: 4,
  every_other_day: 1,
  as_needed: 1,
  other: 1,
};

/**
 * Препараты, которые ребёнок принимает на дату листа или начнёт позже, — правило
 * кита: тот же список показывает семье «Схема препаратов» в Mini App.
 */
export function scheduledMedications(
  items: readonly Medication[],
  today: string,
): Medication[] {
  return scheduledFromKit(items, today);
}

/**
 * Срок приёма словами. Какие слова и с какими датами — решает кит
 * (`medicationTerm`), одинаково для листа и экрана Mini App; дата окончания
 * печатается всегда, когда она задана.
 */
function termOf(item: Medication, today: string, t: TFunction): string {
  const term = medicationTerm(item, today);
  switch (term.key) {
    case "startsUntil":
      return t("doctor:medications.sheet.startsUntil", {
        from: formatIsoDate(term.from),
        to: formatIsoDate(term.to),
      });
    case "until":
      return t("doctor:medications.sheet.until", {
        date: formatIsoDate(term.date),
      });
    case "startsOn":
      return t("doctor:medications.sheet.startsOn", {
        date: formatIsoDate(term.date),
      });
    case "ongoing":
      return t("doctor:medications.sheet.ongoing");
  }
}

/**
 * Лист «Схема приёма препаратов» для семьи (ADR-0092, этап 6): что, сколько и
 * как часто — словами врача, и неделя клеток, чтобы отмечать каждый приём.
 *
 * Время приёма лист не придумывает: строк в дне столько, сколько говорит
 * кратность, а «утром и на ночь» — уточнение врача, оно стоит в таблице.
 */
export function MedicationScheduleSheet({
  medications,
  today,
}: {
  medications: readonly Medication[];
  today: string;
}) {
  const { t } = useTranslation("doctor");
  const label = (code: MedicationFrequency) =>
    t(`medications.frequencyCodes.${code}`);
  const days = t("medications.sheet.days", { returnObjects: true }) as string[];

  return (
    <div className="flex flex-col gap-[5mm] text-[12pt] leading-snug">
      <div className="flex flex-col gap-[1.5mm]">
        <h1 className="m-0 text-[20pt] leading-tight font-bold">
          {t("medications.sheet.title")}
        </h1>
        <p className="m-0 text-[#3d4556]">
          {t("medications.sheet.asOf", { date: formatIsoDate(today) })}
        </p>
      </div>

      <table className="w-full border-collapse text-[11pt]">
        <thead>
          <tr className="border-b-2 border-[#1a1f2e] text-left">
            <th scope="col" className="py-[1.5mm] pr-[3mm] font-semibold">
              {t("medications.sheet.drug")}
            </th>
            <th scope="col" className="py-[1.5mm] pr-[3mm] font-semibold">
              {t("medications.sheet.dose")}
            </th>
            <th scope="col" className="py-[1.5mm] pr-[3mm] font-semibold">
              {t("medications.sheet.how")}
            </th>
            <th scope="col" className="py-[1.5mm] font-semibold">
              {t("medications.sheet.from")}
            </th>
          </tr>
        </thead>
        <tbody>
          {medications.map((item) => (
            <tr
              key={item.id}
              className="break-inside-avoid border-b border-[#c9ced8]"
            >
              <td className="py-[1.5mm] pr-[3mm] font-semibold">
                {item.drug_name}
              </td>
              <td className="py-[1.5mm] pr-[3mm]">{item.dose}</td>
              <td className="py-[1.5mm] pr-[3mm]">
                {describeFrequency(item, label)}
              </td>
              <td className="py-[1.5mm]">{termOf(item, today, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col gap-[2mm]">
        <h2 className="m-0 text-[14pt] font-bold">
          {t("medications.sheet.gridTitle")}
        </h2>
        <p className="m-0 text-[10.5pt] text-[#4a5263]">
          {t("medications.sheet.gridHint")}
        </p>
        <table className="w-full border-collapse text-[10.5pt]">
          <thead>
            <tr>
              <th
                scope="col"
                className="border border-[#8a93a3] px-[2mm] py-[1mm] text-left font-semibold"
              >
                {t("medications.sheet.drug")}
              </th>
              {days.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className="w-[13mm] border border-[#8a93a3] px-[1mm] py-[1mm] text-center font-semibold"
                >
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {medications.flatMap((item) => {
              const count = INTAKES_PER_DAY[item.frequency_code ?? "other"];
              return Array.from({ length: count }, (_, index) => (
                <tr key={`${item.id}-${index}`} className="break-inside-avoid">
                  <th
                    scope="row"
                    className="border border-[#8a93a3] px-[2mm] py-[2.5mm] text-left font-normal"
                  >
                    {item.drug_name}
                    {count > 1 &&
                      ` · ${t("medications.sheet.intake", { number: index + 1 })}`}
                    {item.frequency_code === "as_needed" &&
                      ` · ${t("medications.sheet.asNeededCell")}`}
                  </th>
                  {days.map((day) => (
                    <td
                      key={day}
                      className="border border-[#8a93a3]"
                      aria-label={t("medications.sheet.cell", { day })}
                    />
                  ))}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      <div className="flex gap-[3mm] rounded-[1.5mm] border-2 border-[#8a5300] bg-[#fef6e6] px-[4mm] py-[3mm]">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#8a5300"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="mt-[0.5mm] shrink-0"
        >
          <path d="M12 3 2 21h20L12 3z" />
          <path d="M12 10v5" />
          <path d="M12 18h.01" />
        </svg>
        <p className="m-0">
          <b className="text-[#8a5300]">
            {t("medications.sheet.warningTitle")}
          </b>{" "}
          {t("medications.sheet.warning")}
        </p>
      </div>

      <p
        lang="uz"
        className="m-0 border-t border-[#c9ced8] pt-[3mm] text-[11pt]"
      >
        {t("medications.sheet.uz")}
      </p>
    </div>
  );
}
