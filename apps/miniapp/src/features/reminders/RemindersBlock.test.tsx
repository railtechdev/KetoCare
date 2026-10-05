import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@ketocare/ui";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { RemindersBlock } from "./RemindersBlock";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), PUT: vi.fn() } };
});

const SESSION = {
  patientId: "11111111-1111-4111-8111-111111111111",
  patientName: "Амина",
  webUrl: "https://ketocare.example",
  hasWebCredentials: false,
};

/** Умолчание сервера: включено, одно вечернее напоминание. */
const DEFAULTS = {
  patient_id: SESSION.patientId,
  enabled: true,
  ketones_at: null,
  weight_at: null,
  medications_at: null,
  no_records_at: "20:00:00",
};

function renderBlock() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
      </QueryClientProvider>
    );
  }
  return render(<RemindersBlock session={SESSION} />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockResolvedValue({ data: DEFAULTS });
  (api.PUT as Mock).mockImplementation(
    (_path: string, init: { body: object }) =>
      Promise.resolve({
        data: { patient_id: SESSION.patientId, ...init.body },
      }),
  );
});

describe("напоминания в Mini App", () => {
  it("показывает умолчания сервера, а не свои", async () => {
    renderBlock();

    expect(await screen.findByLabelText("Присылать напоминания")).toBeChecked();
    expect(screen.getByLabelText("Если за день нет записей")).toHaveValue(
      "20:00",
    );
    expect(screen.getByLabelText("Кетоны")).toHaveValue("");
    expect(api.GET).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/reminders",
      { params: { path: { patient_id: SESSION.patientId } } },
    );
  });

  it("сохраняет время кетонов PUT-ом со всеми полями", async () => {
    const user = userEvent.setup();
    renderBlock();

    const ketones = await screen.findByLabelText("Кетоны");
    // Поле времени в jsdom не набирается посимвольно — значение ставится
    // целиком, как его отдаёт системный выбор времени на телефоне.
    fireEvent.change(ketones, { target: { value: "08:00" } });
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
    expect(api.PUT).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/reminders",
      {
        params: { path: { patient_id: SESSION.patientId } },
        body: {
          enabled: true,
          ketones_at: "08:00",
          weight_at: null,
          medications_at: null,
          no_records_at: "20:00:00",
        },
      },
    );
    expect(
      await screen.findByText("Напоминания сохранены"),
    ).toBeInTheDocument();
  });

  it("«Выключить» убирает время — вид напоминаний выключен", async () => {
    const user = userEvent.setup();
    renderBlock();

    await user.click(
      await screen.findByRole("button", {
        name: "Выключить напоминание «Если за день нет записей»",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
    expect(api.PUT).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.objectContaining({ no_records_at: null }) as object,
      }),
    );
  });

  it("выключить всё разом — одним флажком", async () => {
    const user = userEvent.setup();
    renderBlock();

    await user.click(await screen.findByLabelText("Присылать напоминания"));
    expect(screen.getByLabelText("Если за день нет записей")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(api.PUT).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.objectContaining({
            enabled: false,
            no_records_at: "20:00:00",
          }) as object,
        }),
      ),
    );
  });

  it("отказ сервера показывается его словами", async () => {
    (api.PUT as Mock).mockResolvedValue({
      error: { error: { code: "validation_error", message: "Время не то." } },
    });
    const user = userEvent.setup();
    renderBlock();

    await user.click(await screen.findByRole("button", { name: "Сохранить" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Время не то.");
  });
});
