import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { SectionRouter } from "../../test/SectionRouter";
import { RecipeForm } from "./RecipeForm";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

const BUTTER = "11111111-1111-4111-8111-111111111111";

const PRODUCT = {
  id: BUTTER,
  name_ru: "Масло сливочное",
  kcal_100g: 748,
  fat_100g: 82.5,
  protein_100g: 0.5,
  carbs_100g: 0.8,
  fiber_100g: 0,
  is_active: true,
};

/** Ответ ядра: итог блюда и вклад позиции (ENGINE_VERSION 1.0.0). */
const VERIFIED = {
  dish: {
    items: [
      {
        product_id: BUTTER,
        grams: 50,
        kcal: 374,
        fat_g: 41.25,
        protein_g: 0.25,
        carbs_g: 0.4,
        fiber_g: 0,
      },
    ],
    kcal: 374,
    fat_g: 41.25,
    protein_g: 0.25,
    carbs_g: 0.4,
    fiber_g: 0,
    net_carbs_g: 0.4,
    ratio: 63.5,
    engine_version: "1.0.0",
  },
  ratio_within_tolerance: null,
  kcal_within_tolerance: null,
  excluded: [],
};

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="recipes">{children}</SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <RecipeForm
      mode="create"
      defaultValues={{ category: "breakfast", servings: 1, ingredients: [] }}
      pending={false}
      error={null}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { wrapper: Wrapper },
  );
}

async function addButter(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Добавить продукт/), "масло");
  await user.click(await screen.findByRole("option", { name: /Масло/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation(async (path: string) =>
    path === "/api/v1/products/{product_id}"
      ? { data: PRODUCT, error: undefined }
      : { data: { items: [PRODUCT], total: 1 }, error: undefined },
  );
  (api.POST as Mock).mockResolvedValue({ data: VERIFIED, error: undefined });
});

describe("показатели в форме рецепта", () => {
  it("считает блюдо по мере правки состава, а не после сохранения", async () => {
    // Раньше под составом стояло «показатели пересчитываются на сервере после
    // сохранения»: подобрать граммовку в форме было нельзя в принципе.
    // Заказчица просила об этом дважды — про блюдо целиком и про каждую строку.
    const user = userEvent.setup();
    renderForm();
    await addButter(user);

    expect(await screen.findByText(/374 ккал/)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Соотношение 63\.5|Соотношение/),
    ).toBeInTheDocument();
  });

  it("показывает вклад каждой позиции числами сервера", async () => {
    const user = userEvent.setup();
    renderForm();
    await addButter(user);

    const contribution = await screen.findByRole("group", {
      name: /Вклад продукта «Масло сливочное»/,
    });
    expect(contribution).toHaveTextContent("374");
    expect(contribution).toHaveTextContent("41.3");
  });

  it("не считает в браузере: числа берутся из ответа сервера", async () => {
    const user = userEvent.setup();
    renderForm();
    await addButter(user);

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/calc/verify",
        expect.objectContaining({
          body: expect.objectContaining({
            // Продукт уходит вместе со значениями на 100 г: считает ядро.
            ingredients: [
              expect.objectContaining({ product_id: BUTTER, kcal: 748 }),
            ],
            items: [expect.objectContaining({ product_id: BUTTER, grams: 50 })],
            // Цели у рецепта нет: он общий, не привязан к ребёнку.
            targets: null,
            patient_id: null,
          }),
        }),
      ),
    );
  });

  it("пустой состав в расчёт не уходит", async () => {
    renderForm();

    await screen.findByLabelText(/Добавить продукт/);
    expect(api.POST).not.toHaveBeenCalled();
  });

  it("неполный состав в расчёт не уходит", async () => {
    // Сервер посчитал бы такой состав честно — и вернул бы уверенное число не о
    // том блюде. Это главное, ради чего в хуке есть `usable`/`complete`.
    const user = userEvent.setup();
    renderForm();
    await addButter(user);
    await screen.findByText(/374 ккал/);

    const before = (api.POST as Mock).mock.calls.length;
    await user.clear(screen.getByLabelText(/Масса продукта «Масло сливочное»/));
    // Дольше задержки автопересчёта: иначе проверка пройдёт просто потому, что
    // таймер ещё не сработал.
    await new Promise((resolve) => setTimeout(resolve, 900));

    expect((api.POST as Mock).mock.calls.length).toBe(before);
  });

  it("убранный из состава продукт не оставляет своих чисел", async () => {
    // Прежний ответ держится на экране, пока считается новый, — и после
    // удаления последней строки он остался бы числами о блюде, которого нет.
    const user = userEvent.setup();
    renderForm();
    await addButter(user);
    expect(await screen.findByText(/374 ккал/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Убрать/ }));

    await waitFor(() =>
      expect(screen.queryByText(/374 ккал/)).not.toBeInTheDocument(),
    );
  });

  it("отказ расчёта не мешает сохранить рецепт", async () => {
    // Показатели — подспорье при наборе состава, а не условие сохранения:
    // сервер посчитает их сам при записи.
    (api.POST as Mock).mockResolvedValue({
      data: undefined,
      error: { error: { code: "internal", message: "Сервер недоступен." } },
    });
    const user = userEvent.setup();
    renderForm();
    await addButter(user);

    expect(
      await screen.findByText(/Показатели сейчас не посчитать/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Создать рецепт" }),
    ).toBeEnabled();
  });
});
