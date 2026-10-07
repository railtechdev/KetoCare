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
    (api.POST as Mock).mockResolvedValue({ data: {}, error: undefined });
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
