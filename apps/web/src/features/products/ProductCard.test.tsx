import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import productsRu from "../../locales/ru/products.json";
import { SessionProvider } from "../auth/session";
import { SectionRouter } from "../../test/SectionRouter";
import { ProductCard } from "./ProductCard";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "products", productsRu, true, true);

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function token(role: string) {
  return `header.${btoa(JSON.stringify({ sub: USER_ID, role }))}.signature`;
}

const PRODUCT = {
  id: PRODUCT_ID,
  name_ru: "Масло сливочное",
  name_uz: null,
  name_en: null,
  category_id: "c1",
  kcal_100g: 717,
  fat_100g: 81.1,
  protein_100g: 0.9,
  carbs_100g: 0.1,
  fiber_100g: 0,
  source: "USDA FoodData Central",
  source_version: "SR Legacy 2018-04, fdc 173410",
  verified_at: "2026-01-01",
  is_active: true,
};

const REVISIONS = {
  items: [
    {
      id: "r2",
      changed_by: USER_ID,
      changed_by_name: "Анна Диетолог",
      changed_at: "2026-08-20T10:00:00Z",
      snapshot: { ...PRODUCT, fat_100g: 81.1, source: "USDA FoodData Central" },
    },
    {
      id: "r1",
      changed_by: USER_ID,
      changed_by_name: "Анна Диетолог",
      changed_at: "2026-08-01T10:00:00Z",
      snapshot: { ...PRODUCT, fat_100g: 82.5 },
    },
  ],
  total: 2,
};

let role = "doctor";

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SessionProvider>
          <SectionRouter section="products">{children}</SectionRouter>
        </SessionProvider>
      </QueryClientProvider>
    );
  }

  return render(<ProductCard productId={PRODUCT_ID} onBack={() => {}} />, {
    wrapper: Wrapper,
  });
}

describe("карточка продукта", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    role = "doctor";
    (api.POST as Mock).mockImplementation(async (path: string) =>
      path === "/api/v1/auth/refresh"
        ? { data: { access_token: token(role) }, error: undefined }
        : { data: undefined, error: undefined },
    );
    (api.GET as Mock).mockImplementation(async (path: string) =>
      path.includes("revisions")
        ? { data: REVISIONS, error: undefined }
        : { data: PRODUCT, error: undefined },
    );
  });

  it("показывает происхождение значений, а не только числа", async () => {
    // Раньше `source_version` и дату сверки видел только администратор в форме
    // правки — при том что именно они отвечают на вопрос, можно ли доверять
    // числам, по которым считают еду ребёнку.
    renderCard();

    expect(await screen.findByText("717 ккал")).toBeInTheDocument();
    expect(
      screen.getByText("SR Legacy 2018-04, fdc 173410"),
    ).toBeInTheDocument();
    expect(screen.getByText("2026-01-01")).toBeInTheDocument();
  });

  it("показывает историю разницей, а не снимком целиком", async () => {
    renderCard();

    // «Жиры 82.5 → 81.1» отвечает на вопрос, ради которого сюда приходят;
    // полный список из одиннадцати полей его прячет.
    await screen.findByText(/Жиры, г/);

    // Именно записи истории: на экране есть и другие списки (расшифровка
    // макросов), а внутри самой записи — вложенный список изменённых полей.
    const entries = Array.from(
      screen.getByRole("list", { name: "История изменений" }).children,
    );
    // Порядок — от новых к старым, и разница считается с ПРЕДЫДУЩЕЙ записью.
    // Перепутанное направление дало бы «81.1 → 82.5», то есть правку наоборот:
    // по такой истории и восстанавливают, что было до инцидента.
    const latest = entries[0]?.textContent ?? "";
    expect(latest).toContain("Жиры, г");
    expect(latest.indexOf("82.5")).toBeGreaterThan(-1);
    expect(latest.indexOf("82.5")).toBeLessThan(latest.indexOf("81.1"));

    // Автор назван у каждой записи: идентификатор без имени отвечает «кто-то».
    expect(screen.getAllByText("Анна Диетолог")).toHaveLength(2);
    // У самой старой записи разницы нет — это заведение позиции.
    expect(entries[1]?.textContent).toContain("позиция заведена");
  });

  it("семье историю не показывает и не запрашивает", async () => {
    // Сервер её родителю и не отдаёт (403): запрос был бы заведомым отказом,
    // а блок — обещанием того, чего нет (правило П3 канона).
    role = "parent";
    renderCard();

    expect(await screen.findByText("717 ккал")).toBeInTheDocument();
    expect(screen.queryByText(/История изменений/)).not.toBeInTheDocument();
    expect(api.GET).not.toHaveBeenCalledWith(
      "/api/v1/products/{product_id}/revisions",
      expect.anything(),
    );
  });
});
