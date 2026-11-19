import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import type { ControlSchedule, ControlVisit } from "./therapyCourse";
import { upcomingVisits, VisitScheduleSheet } from "./VisitScheduleSheet";

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

function visit(overrides: Partial<ControlVisit>): ControlVisit {
  return {
    id: "v1",
    patient_id: "p1",
    planned_on: "2026-12-02",
    month_offset: 3,
    completed_on: null,
    note: null,
    purpose: null,
    labs: ["Общий анализ крови", "Липидный профиль"],
    overdue: false,
    ...overrides,
  } as ControlVisit;
}

const SCHEDULE = {
  visits: [],
  therapy_started_on: "2026-09-02",
  weekly_labs: ["Кетоны в моче"],
  periodic_labs: ["Кальций в моче"],
} as unknown as ControlSchedule;

describe("visit schedule sheet (ADR-0092)", () => {
  it("keeps the visits still ahead, by date", () => {
    const visits = [
      visit({ id: "late", planned_on: "2027-03-02" }),
      visit({
        id: "done",
        planned_on: "2026-10-02",
        completed_on: "2026-10-02",
      }),
      visit({ id: "next", planned_on: "2026-12-02" }),
    ];

    expect(upcomingVisits(visits).map((v) => v.id)).toEqual(["next", "late"]);
  });

  it("lists each visit with what to bring and the clinic's lab lists", () => {
    render(
      <VisitScheduleSheet
        schedule={SCHEDULE}
        visits={[visit({}), visit({ id: "m", month_offset: null, labs: [] })]}
      />,
    );

    expect(screen.getAllByText("02.12.2026", { selector: "td" })).toHaveLength(
      2,
    );
    expect(screen.getByText("3 месяца от начала")).toBeInTheDocument();
    expect(screen.getByText("вне графика")).toBeInTheDocument();
    expect(
      screen.getByText("Общий анализ крови, Липидный профиль"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Кетоны в моче/)).toBeInTheDocument();
    expect(screen.getByText("Терапия начата 02.09.2026.")).toBeInTheDocument();
  });
});
