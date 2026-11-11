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
    // `response` в подмене обязателен: настоящий клиент отдаёт его всегда, а
    // запрос карточки различает по нему 404 («такого продукта нет») и сбой
    // связи. Мок без `response` — форма, которой в бою не бывает.
    (api.GET as Mock).mockImplementation(async (path: string) =>
      path.includes("revisions")
        ? { data: REVISIONS, error: undefined, response: { status: 200 } }
        : { data: PRODUCT, error: undefined, response: { status: 200 } },
    );
  });

  it("отсутствующий продукт называется отсутствующим, а не пустой карточкой", async () => {
    // 404 — ответ справочника «такого продукта нет»: ссылка устарела или
    // продукт стёрли. Ключ карточки общий с рецептом и формой, и пока у
    // каждого потребителя было своё тело запроса, положенный соседом `null`
    // читался здесь как «данных нет вовсе» — карточка рисовалась пустой, без
    // ошибки и без объяснения.
    (api.GET as Mock).mockImplementation(async () => ({
      error: { error: { code: "not_found", message: "Не найден." } },
      response: { status: 404 },
    }));
    renderCard();

    expect(
      await screen.findByText(productsRu.card.notFound as string),
    ).toBeInTheDocument();
    expect(screen.queryByText("7,17")).not.toBeInTheDocument();
  });

  it("у числа с отдельным происхождением стоит подпись источника", async () => {
    // ADR-0067: число копии взято из стандарта либо вписано человеком, и
    // карточка обязана это сказать рядом с самим числом.
    (api.GET as Mock).mockImplementation(async () => ({
      data: {
        ...PRODUCT,
        value_sources: {
          fat_100g: {
            kind: "manual",
            product_id: null,
            user_id: USER_ID,
            at: "2026-11-10T09:00:00Z",
            label: "Анна Диетолог",
          },
          protein_100g: {
            kind: "product",
            product_id: "p0",
            user_id: null,
            at: null,
            label: "СанПиН 2025",
          },
        },
      },
      error: undefined,
      response: { status: 200 },
    }));
    renderCard();

    expect(
      await screen.findByText("правка: Анна Диетолог, 10.11.2026"),
    ).toBeInTheDocument();
    expect(screen.getByText("из стандарта «СанПиН 2025»")).toBeInTheDocument();
  });

  it("прочерк источника — «нет данных», а не ноль; отходы — процентом", async () => {
    // ADR-0067: в таблице Минздрава РУз у мяса прочерк в углеводах, и ноль
    // в колонке значит «источник не приводит», а не «углеводов нет».
    (api.GET as Mock).mockImplementation(async () => ({
      data: {
        ...PRODUCT,
        name_ru: "Говядина I категории",
        carbs_100g: 0,
        fiber_known: false,
        unknown_fields: ["carbs_100g", "fiber_100g"],
        waste_pct: 25,
      },
      error: undefined,
      response: { status: 200 },
    }));
    renderCard();

    expect(await screen.findByText("Отходы: 25 %")).toBeInTheDocument();
    expect(screen.getAllByText(productsRu.card.noData)).toHaveLength(2);
    // Сервер такой продукт в расчёт не пустит — кнопки в калькулятор нет.
    expect(
      screen.queryByText(productsRu.actions.toCalculator),
    ).not.toBeInTheDocument();
  });

  it("показывает происхождение значений, а не только числа", async () => {
    // Раньше `source_version` и дату сверки видел только администратор в форме
    // правки — при том что именно они отвечают на вопрос, можно ли доверять
    // числам, по которым считают еду ребёнку.
    renderCard();

    expect(await screen.findByText("7,17")).toBeInTheDocument();
    expect(
      screen.getByText("SR Legacy 2018-04, fdc 173410"),
    ).toBeInTheDocument();
    // Дата по-русски, а не ISO из ответа (П45).
    expect(screen.getByText("01.01.2026")).toBeInTheDocument();
  });

  it("показывает историю разницей, а не снимком целиком", async () => {
    renderCard();

    // «Жиры 82.5 → 81.1» отвечает на вопрос, ради которого сюда приходят;
    // полный список из одиннадцати полей его прячет.
    await screen.findByRole("list", { name: "История изменений" });

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
    // Числа русской записью (П45) и на 1 г, как в карточке (ADR-0065).
    expect(latest.indexOf("0,825")).toBeGreaterThan(-1);
    expect(latest.indexOf("0,825")).toBeLessThan(latest.indexOf("0,811"));

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

    expect(await screen.findByText("7,17")).toBeInTheDocument();
    expect(screen.queryByText(/История изменений/)).not.toBeInTheDocument();
    expect(api.GET).not.toHaveBeenCalledWith(
      "/api/v1/products/{product_id}/revisions",
      expect.anything(),
    );
  });
});
