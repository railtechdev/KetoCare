import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import doctorRu from "../../locales/ru/doctor.json";
import { GrowthView } from "./GrowthView";
import { TherapyCourseView } from "./TherapyCourseView";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: {
      GET: vi.fn(),
      POST: vi.fn(),
      PUT: vi.fn(),
      PATCH: vi.fn(),
      DELETE: vi.fn(),
    },
  };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

let profile: Record<string, unknown> | null = null;
let visits: unknown[] = [];

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  profile = { therapy_ended_on: null, therapy_end_reason: null };
  visits = [];
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path.endsWith("/medical-profile")) {
      return Promise.resolve(
        profile ? { data: profile } : { error: { error: {} } },
      );
    }
    if (path.endsWith("/control-schedule")) {
      return Promise.resolve({
        data: {
          visits,
          therapy_started_on: "2026-01-31",
          weekly_labs: ["ОАК"],
          periodic_labs: ["Липидный профиль"],
        },
      });
    }
    if (path.endsWith("/growth")) {
      return Promise.resolve({
        data: {
          points: [
            {
              measured_on: "2026-04-20",
              age_days: 2911,
              weight_kg: 20,
              height_cm: null,
              bmi: null,
              wfa: { z: -1.2, percentile: 11.5 },
              hfa: null,
              bmi_for_age: null,
            },
          ],
          indicators: [
            {
              indicator: "wfa",
              baseline_on: "2025-04-20",
              baseline: { z: 0, percentile: 50 },
              latest_on: "2026-04-20",
              latest: { z: -1.2, percentile: 11.5 },
              change_sd: -1.2,
              significant_drop: true,
            },
            { indicator: "hfa", significant_drop: false },
            { indicator: "bmi", significant_drop: false },
          ],
          significant_drop_sd: 1,
          source: "WHO Child Growth Standards (2006)",
        },
      });
    }
    return Promise.resolve({ data: {} });
  });
});

describe("ход терапии (вопросы 17, 18, 34)", () => {
  it("врач завершает терапию: причина обязательна, «другое» — с пояснением", async () => {
    (api.PUT as Mock).mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    render(<TherapyCourseView patientId={PATIENT_ID} editable />, {
      wrapper: wrapper(),
    });

    await user.click(
      await screen.findByRole("button", { name: doctorRu.course.status.end }),
    );
    await user.click(
      screen.getByRole("button", { name: doctorRu.course.status.endSubmit }),
    );
    // Под полем и строкой в сводке ошибок (правило П8).
    expect(
      await screen.findAllByText(doctorRu.course.errors.reason),
    ).toHaveLength(2);
    expect(api.PUT).not.toHaveBeenCalled();

    await user.selectOptions(
      screen.getByLabelText(doctorRu.course.fields.reason, { exact: false }),
      "other",
    );
    await user.click(
      screen.getByRole("button", { name: doctorRu.course.status.endSubmit }),
    );
    expect(
      await screen.findAllByText(doctorRu.course.errors.note),
    ).toHaveLength(2);

    await user.type(
      screen.getByLabelText(doctorRu.course.fields.note, { exact: false }),
      "переезд",
    );
    await user.click(
      screen.getByRole("button", { name: doctorRu.course.status.endSubmit }),
    );
    await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
    const [path, options] = (api.PUT as Mock).mock.calls[0] as [
      string,
      { body: { reason: string; note: string | null } },
    ];
    expect(path).toBe("/api/v1/patients/{patient_id}/therapy-end");
    expect(options.body.reason).toBe("other");
    expect(options.body.note).toBe("переезд");
  });

  it("диетолог читает, но не меняет", async () => {
    visits = [
      {
        id: "v1",
        patient_id: PATIENT_ID,
        planned_on: "2026-07-31",
        month_offset: 6,
        completed_on: null,
        note: null,
        purpose: "efficacy_review",
        labs: ["ОАК", "ЭКГ"],
        overdue: true,
      },
    ];
    render(<TherapyCourseView patientId={PATIENT_ID} editable={false} />, {
      wrapper: wrapper(),
    });

    expect(
      await screen.findByText(doctorRu.course.purpose.efficacy_review),
    ).toBeInTheDocument();
    expect(
      screen.getByText(doctorRu.course.visits.overdue),
    ).toBeInTheDocument();
    expect(screen.getByText(/ОАК, ЭКГ/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: doctorRu.course.status.end }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: doctorRu.course.visits.add }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: doctorRu.course.visits.markDone }),
    ).toBeNull();
  });

  it("график строится кнопкой, когда дата начала известна", async () => {
    (api.POST as Mock).mockResolvedValue({ data: [{ id: "v1" }] });
    const user = userEvent.setup();
    render(<TherapyCourseView patientId={PATIENT_ID} editable />, {
      wrapper: wrapper(),
    });

    const build = await screen.findByRole("button", {
      name: doctorRu.course.visits.build,
    });
    await waitFor(() => expect(build).toBeEnabled());
    await user.click(build);
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/control-visits/schedule",
        { params: { path: { patient_id: PATIENT_ID } } },
      ),
    );
  });
});

describe("рост и вес по ВОЗ (вопрос 15)", () => {
  it("показывает z-балл с перцентилем и значимое снижение", async () => {
    render(<GrowthView patientId={PATIENT_ID} />, { wrapper: wrapper() });

    expect(
      await screen.findByText(doctorRu.growth.significantDrop),
    ).toBeInTheDocument();
    // Число — по-русски, с запятой (правило П45).
    expect(
      screen.getAllByText(
        /−1,20 SD · 11,5-й перцентиль|-1,20 SD · 11,5-й перцентиль/,
      ).length,
    ).toBeGreaterThan(0);
  });
});
