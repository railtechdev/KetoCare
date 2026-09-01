import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import childRu from "../../locales/ru/child.json";
import { SectionRouter } from "../../test/SectionRouter";
import { ChildPage } from "./ChildPage";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() } };
});

i18n.addResourceBundle("ru", "child", childRu, true, true);

const CHILD_ID = "11111111-1111-4111-8111-111111111111";

const CHILD = {
  id: CHILD_ID,
  full_name: "Аня Иванова",
  birth_date: "2019-04-12",
  sex: "f",
  height_cm: 104,
  allergies: [],
  excluded_products: [],
  allergy_labels: [],
  notes: null,
  created_at: "2026-08-01T10:00:00Z",
};

function renderPage(search: Record<string, string>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="child" search={search}>
          {children}
        </SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<ChildPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path === "/api/v1/patients") {
      return Promise.resolve({ data: { items: [CHILD], total: 1 } });
    }
    return Promise.resolve({ data: { items: [], total: 0 } });
  });
});

describe("подэкраны раздела «Ребёнок» живут в адресе", () => {
  it("ссылка на анкету открывает анкету, а не список", async () => {
    // До этого адрес оставался /app/child: F5 посреди заполнения анкеты
    // возвращал к списку, а «Назад» браузера уводил из раздела вовсе.
    renderPage({ tab: "intake", item: CHILD_ID });

    expect(await screen.findByText(/Анкета: Аня Иванова/)).toBeInTheDocument();
  });

  it("без ребёнка в адресе показывает список, а не пустой экран", async () => {
    // Ссылка могла устареть: ребёнка удалили, адрес остался.
    renderPage({ tab: "documents" });

    expect(await screen.findByText("Аня Иванова")).toBeInTheDocument();
  });

  it("по умолчанию — список детей", async () => {
    renderPage({});

    expect(await screen.findByText("Аня Иванова")).toBeInTheDocument();
  });
});
