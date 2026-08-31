import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import telegramRu from "../../locales/ru/telegram.json";
import { RemindersPanel } from "./RemindersPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), PUT: vi.fn() } };
});

i18n.addResourceBundle("ru", "telegram", telegramRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

const DEFAULTS = {
  patient_id: PATIENT_ID,
  enabled: true,
  ketones_at: null,
  weight_at: null,
  medications_at: null,
  no_records_at: "20:00:00",
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  return render(<RemindersPanel patientId={PATIENT_ID} />, {
    wrapper: Wrapper,
  });
}

describe("настройки напоминаний", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.GET as Mock).mockResolvedValue({ data: DEFAULTS, error: undefined });
    (api.PUT as Mock).mockResolvedValue({ data: DEFAULTS, error: undefined });
  });

  it("показывает умолчания сервера, а не свои", async () => {
    // Вторая копия умолчаний однажды разошлась бы с первой: экран показывал бы
    // одно, а воркер напоминал по другому.
    renderPanel();

    expect(
      await screen.findByLabelText(/Если за день нет записей/),
    ).toHaveValue("20:00:00");
    expect(screen.getByLabelText(/^Кетоны/)).toHaveValue("");
  });

  it("пустое поле уходит как «выключено», а не как пустая строка", async () => {
    const user = userEvent.setup();
    renderPanel();

    const field = await screen.findByLabelText(/Если за день нет записей/);
    await user.clear(field);
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(api.PUT).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/reminders",
      expect.objectContaining({
        body: expect.objectContaining({ no_records_at: null }),
      }),
    );
  });

  it("выключатель гасит все поля разом", async () => {
    // Нужен в те недели, когда семья в больнице и напоминания только мешают.
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole("checkbox", { name: "Присылать напоминания" }),
    );

    expect(screen.getByLabelText(/Если за день нет записей/)).toBeDisabled();
  });
});
