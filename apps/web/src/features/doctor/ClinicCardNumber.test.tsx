import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { ClinicCardNumber } from "./ClinicCardNumber";
import type { Patient } from "./types";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), PUT: vi.fn() } };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "Образцова Мария",
  birth_date: "2020-03-12",
  sex: "f",
  height_cm: 112,
  allergies: [],
  notes: null,
  clinic_card_number: null,
} as unknown as Patient;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.clearAllMocks());

describe("ClinicCardNumber", () => {
  it("says the number is not set and offers to set it", () => {
    render(<ClinicCardNumber patient={PATIENT} />, { wrapper });

    expect(screen.getByText("не указан")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Указать" })).toBeInTheDocument();
  });

  it("saves the number without stray spaces", async () => {
    (api.PUT as Mock).mockResolvedValue({
      data: { ...PATIENT, clinic_card_number: "А-2026/ 015" },
    });
    const user = userEvent.setup();
    render(<ClinicCardNumber patient={PATIENT} />, { wrapper });

    await user.click(screen.getByRole("button", { name: "Указать" }));
    await user.type(
      await screen.findByLabelText(/№ карты клиники/),
      "  А-2026/   015 ",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    const [path, options] = (api.PUT as Mock).mock.calls[0]!;
    expect(path).toBe("/api/v1/patients/{patient_id}/clinic-card");
    expect(options.body).toEqual({ clinic_card_number: "А-2026/ 015" });
  });

  it("shows the server's refusal of a taken number", async () => {
    (api.PUT as Mock).mockResolvedValue({
      error: {
        error: {
          code: "conflict",
          message:
            "Этот номер карты уже записан у другого пациента. Проверьте номер.",
          details: {},
        },
      },
    });
    const user = userEvent.setup();
    render(
      <ClinicCardNumber patient={{ ...PATIENT, clinic_card_number: "0141" }} />,
      { wrapper },
    );

    await user.click(screen.getByRole("button", { name: "Изменить" }));
    const field = await screen.findByLabelText(/№ карты клиники/);
    await user.clear(field);
    await user.type(field, "0142");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(
      await screen.findByText(/уже записан у другого пациента/),
    ).toBeInTheDocument();
  });

  it("refuses odd characters before asking the server", async () => {
    const user = userEvent.setup();
    render(<ClinicCardNumber patient={PATIENT} />, { wrapper });

    await user.click(screen.getByRole("button", { name: "Указать" }));
    await user.type(await screen.findByLabelText(/№ карты клиники/), "<0142>");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(
      (await screen.findAllByText(/до 32 знаков: буквы, цифры/)).length,
    ).toBeGreaterThan(0);
    expect(api.PUT).not.toHaveBeenCalled();
  });
});
