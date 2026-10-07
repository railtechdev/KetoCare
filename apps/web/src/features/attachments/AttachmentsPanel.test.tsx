import { Toaster } from "@ketocare/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import attachmentsRu from "../../locales/ru/attachments.json";
import { AttachmentsPanel } from "./AttachmentsPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() } };
});

vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "p1", role: "parent" } }),
}));

i18n.addResourceBundle("ru", "attachments", attachmentsRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

const DISCHARGE = {
  id: "22222222-2222-4222-8222-222222222222",
  filename: "vypiska.pdf",
  mime: "application/pdf",
  size_bytes: 1000,
  doc_kind: "discharge",
  doc_date: "2026-09-01",
  description: "Выписка из стационара",
  uploaded_by: "p1",
  created_at: "2026-09-02T10:00:00Z",
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
      </QueryClientProvider>
    );
  }
  return render(<AttachmentsPanel patientId={PATIENT_ID} />, {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockResolvedValue({ data: [DISCHARGE] });
  (api.POST as Mock).mockResolvedValue({ data: DISCHARGE });
});

describe("документы ребёнка", () => {
  it("список на виду, а форма загрузки — за кнопкой (П32)", async () => {
    renderPanel();

    expect(
      await screen.findByRole("link", { name: "Выписка из стационара" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Файл/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Добавить документ" }),
    ).toBeInTheDocument();
  });

  it("выбор файла не отправляет его: отправляет «Загрузить» (П9)", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: "Добавить документ" }),
    );

    const submit = await screen.findByRole("button", { name: "Загрузить" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription("Файл не выбран");

    const file = new File(["%PDF"], "eeg.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText(/^Файл/), file);
    await user.selectOptions(screen.getByLabelText(/Вид документа/), "eeg");

    expect(api.POST).not.toHaveBeenCalled();

    await user.click(submit);

    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    const body = (api.POST as Mock).mock.calls[0]![1].body as FormData;
    expect(body.get("doc_kind")).toBe("eeg");
    expect((body.get("file") as File).name).toBe("eeg.pdf");

    // Панель закрывается только после успеха.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Загрузить" })).toBeNull(),
    );
  });
});
