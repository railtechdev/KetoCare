import { formatIsoDate } from "../doctor/dates";
import type { PatientIntake } from "./useIntake";

/**
 * Дата последнего приступа в анкете — частичная, как `date` в HL7 FHIR
 * (вопрос 48, ADR-0049).
 *
 * Семья не всегда помнит число: бывает «в марте», бывает «в прошлом году»,
 * бывает «не помню». Угаданное число в записи неотличимо от точного, а врач
 * судит по нему о длительности ремиссии, поэтому точность — часть ответа.
 * Сервер хранит неточную дату первым днём месяца или года и точность рядом.
 */
export type LastSeizurePrecision = NonNullable<
  PatientIntake["last_seizure_precision"]
>;

/** Поля формы. Пустая точность — «не отвечено», а не «не помню». */
export interface LastSeizureValues {
  precision: "" | LastSeizurePrecision;
  /** `YYYY-MM-DD` при точности «день». */
  day: string;
  /** Номер месяца, «1»–«12». */
  month: string;
  /** Год, «2026». */
  year: string;
}

export const LAST_SEIZURE_EMPTY: LastSeizureValues = {
  precision: "",
  day: "",
  month: "",
  year: "",
};

export const LAST_SEIZURE_PRECISIONS = [
  "day",
  "month",
  "year",
  "unknown",
] as const satisfies readonly LastSeizurePrecision[];

export function isLastSeizurePrecision(
  value: string,
): value is LastSeizurePrecision {
  return (LAST_SEIZURE_PRECISIONS as readonly string[]).includes(value);
}

/** Ответ из сохранённой анкеты — в поля формы. */
export function lastSeizureFromIntake(
  intake: Pick<PatientIntake, "last_seizure_on" | "last_seizure_precision">,
): LastSeizureValues {
  const on = intake.last_seizure_on ?? null;
  // Анкета до частичных дат: дата была только полной.
  const precision = intake.last_seizure_precision ?? (on === null ? "" : "day");
  const [year = "", month = ""] = on === null ? [] : on.split("-");
  return {
    precision,
    day: precision === "day" && on !== null ? on : "",
    month: precision === "month" ? String(Number(month)) : "",
    year: precision === "month" || precision === "year" ? year : "",
  };
}

/**
 * Поля формы — в тело запроса. `null` у даты — даты нет (не отвечено, «не
 * помню» или ответ не дописан: недописанный ответ ловит `isLastSeizureComplete`).
 */
export function lastSeizureToBody(values: LastSeizureValues): {
  last_seizure_on: string | null;
  last_seizure_precision: LastSeizurePrecision | null;
} {
  const precision = values.precision === "" ? null : values.precision;
  let on: string | null = null;
  if (precision === "day" && values.day !== "") on = values.day;
  if (precision === "month" && values.month !== "" && values.year !== "") {
    on = `${values.year}-${values.month.padStart(2, "0")}-01`;
  }
  if (precision === "year" && values.year !== "") on = `${values.year}-01-01`;
  return { last_seizure_on: on, last_seizure_precision: precision };
}

/** Ответ дописан: у выбранной точности есть всё, что она требует. */
export function isLastSeizureComplete(values: LastSeizureValues): boolean {
  switch (values.precision) {
    case "":
    case "unknown":
      return true;
    case "day":
      return values.day !== "";
    case "month":
      return values.month !== "" && values.year !== "";
    case "year":
      return values.year !== "";
  }
}

/** «март» — название месяца в именительном падеже, как его называет семья. */
export function monthName(month: number): string {
  return MONTH_FORMAT.format(new Date(2000, month - 1, 1));
}

const MONTH_FORMAT = new Intl.DateTimeFormat("ru-RU", { month: "long" });

/**
 * Дата с той точностью, с какой её помнят: «15.03.2026», «март 2026», «2026».
 *
 * «Март 2026» не печатается как «01.03.2026»: первое число месяца — способ
 * хранения, а не ответ семьи. `null` — даты нет («не помню» подписывает экран).
 */
export function formatLastSeizure(
  on: string | null | undefined,
  precision: LastSeizurePrecision | null | undefined,
): string | null {
  if (on === null || on === undefined) return null;
  const [year = "", month = ""] = on.split("-");
  if (precision === "year") return year;
  if (precision === "month") return `${monthName(Number(month))} ${year}`;
  return formatIsoDate(on);
}
