import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import adminRu from "../../locales/ru/admin.json";
import { SectionRouter } from "../../test/SectionRouter";
import { DictionariesPanel } from "./DictionariesPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
  };
});

i18n.addResourceBundle("ru", "admin", adminRu, true, true);

const ENTRY = {
  id: "s1",
  name_ru: "Тонико-клонический",
  code: "TC",
  sort: 10,
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="dictionaries">{children}</SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<DictionariesPanel />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockResolvedValue({ data: { items: [ENTRY], total: 1 } });
  (api.POST as Mock).mockResolvedValue({ data: ENTRY });
  (api.PATCH as Mock).mockResolvedValue({ data: ENTRY });
  (api.DELETE as Mock).mockResolvedValue({ error: undefined });
});

describe("справочник типов приступов", () => {
  it("показывает короткий код значения", async () => {
    // В клетке месячной сетки «Тонико-клонический» не помещается, «TC» — да
    // (ADR-0007). Без кода сетка подставляет полное название.
    renderPanel();

    expect(await screen.findByText("TC")).toBeInTheDocument();
  });

  it("код задаётся при заведении нового типа", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: /Добавить значение/ }),
    );
    await user.type(await screen.findByLabelText(/Название/), "Атонический");
    await user.type(screen.getByLabelText(/Короткий код/), "A");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/admin/dictionaries/seizure-types",
        expect.objectContaining({
          body: expect.objectContaining({ code: "A" }),
        }),
      );
    });
  });

  it("ошибочное значение удаляется — но только после подтверждения", async () => {
    // Опечатка иначе остаётся в выпадающем списке у всех семей навсегда.
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole("button", {
        name: /Удалить «Тонико-клонический»/,
      }),
    );
    expect(api.DELETE).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Удалить" }));

    await waitFor(() => {
      expect(api.DELETE).toHaveBeenCalledWith(
        "/api/v1/admin/dictionaries/seizure-types/{entry_id}",
        expect.objectContaining({ params: { path: { entry_id: "s1" } } }),
      );
    });
  });
});
