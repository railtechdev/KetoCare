import { toast } from "@ketocare/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import accessRu from "../../locales/ru/access.json";
import { AccessCodePanel } from "./AccessCodePanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

vi.mock("@ketocare/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ketocare/ui")>();
  return {
    ...actual,
    toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  };
});

i18n.addResourceBundle("ru", "access", accessRu, true, true);

const PATIENT_ID = "p1";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ISSUED = {
  code: "NEWC0D3S",
  expires_at: "2026-10-08T10:00:00Z",
  deep_link: null,
  join_url: "https://app.example.org/join?code=NEWC0D3S",
};

describe("выпуск кода при открытии", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.GET as Mock).mockResolvedValue({ data: [] });
  });

  it("код выпускается сам, один раз, а кнопка выпускает следующий", async () => {
    // Аудит продукта 12.11.2026: панель открывают ради кода, и вторая кнопка
    // «Дать доступ семье» внутри неё была лишним нажатием.
    (api.POST as Mock).mockResolvedValue({ data: ISSUED, error: undefined });
    const user = userEvent.setup();
    render(<AccessCodePanel patientId={PATIENT_ID} audience="specialist" />, {
      wrapper,
    });

    expect(await screen.findByText("NEWC0D3S")).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Ещё один код" }));
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  });

  it("отказ выпуска оставляет кнопку повтора", async () => {
    (api.POST as Mock).mockResolvedValue({
      error: { error: { code: "internal", message: "Сервер недоступен." } },
    });
    render(<AccessCodePanel patientId={PATIENT_ID} audience="specialist" />, {
      wrapper,
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Сервер недоступен.",
    );
    expect(
      screen.getByRole("button", { name: "Выдать код" }),
    ).toBeInTheDocument();
  });
});

describe("отзыв кода доступа", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.GET as Mock).mockResolvedValue({
      data: [
        {
          code: "ABCD2345",
          status: "pending",
          purpose: "family_member",
          created_at: "2026-10-01T10:00:00Z",
          expires_at: "2026-10-08T10:00:00Z",
          created_by_name: "Врач",
          activated_by_name: null,
          activated_at: null,
        },
      ],
    });
  });

  it("отказ сервера говорит тостом, а не проглатывается", async () => {
    // Прежде ошибка гасилась `.catch(() => null)`: код оставался действующим,
    // а врач считал его отозванным.
    (api.POST as Mock).mockResolvedValue({
      error: { error: { code: "internal", message: "Сервер недоступен." } },
    });
    const user = userEvent.setup();
    render(<AccessCodePanel patientId={PATIENT_ID} audience="specialist" />, {
      wrapper,
    });

    await user.click(await screen.findByRole("button", { name: "Отозвать" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Отозвать" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Сервер недоступен."),
    );
  });

  it("успех подтверждается тостом", async () => {
    (api.POST as Mock).mockImplementation(async (path: string) =>
      path.endsWith("/revoke")
        ? { data: undefined, error: undefined }
        : { data: ISSUED, error: undefined },
    );
    const user = userEvent.setup();
    render(<AccessCodePanel patientId={PATIENT_ID} audience="specialist" />, {
      wrapper,
    });

    await user.click(await screen.findByRole("button", { name: "Отозвать" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Отозвать" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Код ABCD2345 отозван."),
    );
  });
});
