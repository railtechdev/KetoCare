import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import calculatorRu from "../../locales/ru/calculator.json";
import { SectionRouter } from "../../test/SectionRouter";
import type { Role } from "../auth/roles";
import { SessionContext } from "../auth/sessionContext";
import { ProductPicker } from "./ProductPicker";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

i18n.addResourceBundle("ru", "calculator", calculatorRu, true, true);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <SectionRouter section="calculator">{children}</SectionRouter>
    </QueryClientProvider>
  );
}

/** Роль решает, предлагать ли рецепты: у врача такого раздела нет. */
function withRole(role: Role) {
  return function RoleWrapper({ children }: { children: ReactNode }) {
    return (
      <SessionContext.Provider
        value={{
          session: { userId: "u1", role, patientScope: null },
          restoring: false,
          signIn: () => {},
          signOut: async () => {},
        }}
      >
        {wrapper({ children })}
      </SessionContext.Provider>
    );
  };
}

/**
 * Регрессия: поиск, ничего не нашедший, молчал.
 *
 * Список подсказок просто не появлялся — ровно так же, как пока запрос ещё
 * идёт. Семья у плиты не понимала, ждать ли дальше, и набирала слово заново.
 * Ответ нужен явный, и вместе с ним выход: справочник по тому же слову, где
 * видно, что продукта нет вовсе, а не что опечатка в наборе. Завести продукт
 * семья не может (сервер отдаёт запись admin и dietitian), поэтому выход —
 * именно справочник, а не форма.
 */
describe("поиск продукта в калькуляторе", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("за набранное слово уходит один запрос, а не запрос на букву", async () => {
    // Поиск продукта стоит в калькуляторе, форме рецепта и исключённых
    // продуктах ребёнка и шёл без задержки: «фуагра» — пять запросов к
    // полнотекстовому поиску, из них четыре о недонабранном слове.
    const user = userEvent.setup();
    (api.GET as Mock).mockResolvedValue({
      data: { items: [], total: 0 },
      error: undefined,
    });

    render(<ProductPicker onPick={() => {}} excludeIds={[]} />, { wrapper });

    await user.type(await screen.findByLabelText(/Добавить продукт/), "фуагра");
    expect(
      await screen.findByText(/По запросу «фуагра» ничего не нашлось/),
    ).toBeInTheDocument();

    const searches = (api.GET as Mock).mock.calls.filter(
      ([path]) => path === "/api/v1/products",
    );
    expect(searches).toHaveLength(1);
    expect(searches[0]?.[1]?.params?.query?.q).toBe("фуагра");
  });

  it("говорит, что ничего не нашлось, и даёт два выхода с тем же запросом", async () => {
    const user = userEvent.setup();
    (api.GET as Mock).mockResolvedValue({
      data: { items: [], total: 0 },
      error: undefined,
    });

    render(<ProductPicker onPick={() => {}} excludeIds={[]} suggestRecipes />, {
      wrapper: withRole("parent"),
    });

    // Роутер памяти монтируется асинхронно — поле появляется не сразу.
    await user.type(await screen.findByLabelText(/Добавить продукт/), "фуагра");

    expect(
      await screen.findByText(/По запросу «фуагра» продуктов не нашлось/),
    ).toBeInTheDocument();

    // Запрос уезжает в адрес обоих разделов: набирать слово второй раз, стоя у
    // плиты, — это и есть тупик, который здесь закрывается.
    const catalog = screen.getByRole("link", { name: /Искать в справочнике/ });
    expect(decodeURIComponent(catalog.getAttribute("href") ?? "")).toBe(
      "/app/products?q=фуагра",
    );

    // Второй выход — в рецепты. Заказчица искала здесь «суп из говядины»:
    // название блюда в поиске продуктов. Угадывать за неё, блюдо это или
    // продукт, нельзя — можно назвать оба места.
    const recipes = screen.getByRole("link", { name: /Искать в рецептах/ });
    expect(decodeURIComponent(recipes.getAttribute("href") ?? "")).toBe(
      "/app/recipes?q=фуагра",
    );
  });

  it("не зовёт в рецепты того, у кого этого раздела нет", async () => {
    // У врача раздела «Рецепты» нет (`SECTIONS_BY_ROLE`), и ссылка увела бы его
    // на главную — тупик того же рода, который здесь и закрывается (П3).
    const user = userEvent.setup();
    (api.GET as Mock).mockResolvedValue({
      data: { items: [], total: 0 },
      error: undefined,
    });

    render(<ProductPicker onPick={() => {}} excludeIds={[]} suggestRecipes />, {
      wrapper: withRole("doctor"),
    });

    await user.type(await screen.findByLabelText(/Добавить продукт/), "фуагра");

    expect(
      await screen.findByText(/По запросу «фуагра» ничего не нашлось/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Искать в рецептах/ }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: /Искать в справочнике/ }),
    ).toBeInTheDocument();
  });

  it("вне калькулятора про рецепты не заикается", async () => {
    // Тот же поиск стоит в форме рецепта и в списке исключённых ребёнку
    // продуктов: там совет «искать в рецептах» бессмыслен, а уход по ссылке
    // потерял бы незаписанное.
    const user = userEvent.setup();
    (api.GET as Mock).mockResolvedValue({
      data: { items: [], total: 0 },
      error: undefined,
    });

    render(<ProductPicker onPick={() => {}} excludeIds={[]} />, {
      wrapper: withRole("parent"),
    });

    await user.type(await screen.findByLabelText(/Добавить продукт/), "фуагра");

    expect(
      await screen.findByText(/По запросу «фуагра» ничего не нашлось/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Искать в рецептах/ }),
    ).toBeNull();
  });

  it("молчит, пока найденное есть", async () => {
    const user = userEvent.setup();
    (api.GET as Mock).mockResolvedValue({
      data: {
        items: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name_ru: "Масло сливочное",
            kcal_100g: 748,
            fat_100g: 82.5,
            protein_100g: 0.5,
            carbs_100g: 0.8,
            fiber_100g: 0,
          },
        ],
        total: 1,
      },
      error: undefined,
    });

    render(<ProductPicker onPick={() => {}} excludeIds={[]} />, { wrapper });
    await user.type(await screen.findByLabelText(/Добавить продукт/), "масло");

    await screen.findByRole("option", { name: /Масло сливочное/ });
    expect(screen.queryByText(/ничего не нашлось/)).not.toBeInTheDocument();
  });
});

describe("недавние продукты", () => {
  const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

  const RECENT = [
    {
      id: "22222222-2222-4222-8222-222222222222",
      name_ru: "Масло сливочное",
      kcal_100g: 717,
      fat_100g: 81.1,
      protein_100g: 0.9,
      carbs_100g: 0.1,
      fiber_100g: 0,
      is_active: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (api.GET as Mock).mockImplementation(async (path: string) =>
      path.includes("recent-products")
        ? { data: RECENT, error: undefined }
        : { data: { items: [], total: 0 }, error: undefined },
    );
  });

  it("на пустом поле предлагает то, что семья уже клала в меню", async () => {
    // Поле молчало, пока не набраны два символа, — то есть до ввода не
    // помогало ничем (правило П11 канона).
    render(
      <ProductPicker
        onPick={() => {}}
        excludeIds={[]}
        patientId={PATIENT_ID}
      />,
      {
        wrapper,
      },
    );

    expect(
      await screen.findByRole("button", { name: "Масло сливочное" }),
    ).toBeInTheDocument();
  });

  it("выбранный из недавних уходит тем же путём, что и найденный", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <ProductPicker onPick={onPick} excludeIds={[]} patientId={PATIENT_ID} />,
      {
        wrapper,
      },
    );

    await user.click(
      await screen.findByRole("button", { name: "Масло сливочное" }),
    );

    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Масло сливочное", fat: 81.1 }),
    );
  });

  it("после начала ввода подсказка уступает место поиску", async () => {
    // Ответом на ввод должен быть поиск, а не история.
    const user = userEvent.setup();
    render(
      <ProductPicker
        onPick={() => {}}
        excludeIds={[]}
        patientId={PATIENT_ID}
      />,
      {
        wrapper,
      },
    );

    await screen.findByRole("button", { name: "Масло сливочное" });
    await user.type(screen.getByLabelText(/Добавить продукт/), "кур");

    expect(
      screen.queryByRole("button", { name: "Масло сливочное" }),
    ).not.toBeInTheDocument();
  });

  it("без выбранного ребёнка подсказки нет и запроса тоже", async () => {
    render(<ProductPicker onPick={() => {}} excludeIds={[]} />, { wrapper });

    await screen.findByLabelText(/Добавить продукт/);
    expect(api.GET).not.toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/menus/recent-products",
      expect.anything(),
    );
  });
});
