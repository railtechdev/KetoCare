import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { DishesScreen } from "./DishesScreen";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  };
});

const showBackButton = vi.hoisted(() =>
  vi.fn<(onBack: () => void) => () => void>(() => () => undefined),
);
vi.mock("../../lib/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/telegram")>();
  return { ...actual, showBackButton };
});

const SESSION = {
  patientId: "11111111-1111-4111-8111-111111111111",
  patientName: "Амина",
  children: [],
  webUrl: "https://ketocare.example",
  hasWebCredentials: true,
};

const DISH = {
  id: "d1",
  patient_id: SESSION.patientId,
  title: "Омлет Амины",
  ingredients: [
    { product_id: "p1", grams: 52.5 },
    { product_id: "p2", grams: 0.5 },
  ],
  computed: {
    kcal: 310,
    fat: 30,
    protein: 6,
    carbs: 2,
    fiber: 0,
    ratio: 3.8,
    uncounted_product_ids: ["p2"],
  },
  engine_version: "1.12.0",
  instructions: "Взбить.\nЖарить на масле.",
  source_recipe_id: null,
  created_at: "2026-11-20T10:00:00Z",
};

const PRODUCTS: Record<string, unknown> = {
  p1: {
    id: "p1",
    name_ru: "Яйцо куриное",
    kcal_100g: 157,
    fat_100g: 11.5,
    protein_100g: 12.7,
    carbs_100g: 0.7,
    fiber_100g: 0,
    is_active: true,
  },
  p2: {
    id: "p2",
    name_ru: "Соль",
    kcal_100g: 0,
    fat_100g: 0,
    protein_100g: 0,
    carbs_100g: 0,
    fiber_100g: 0,
    is_active: true,
  },
};

let dishes: unknown[] = [DISH];

function serve() {
  (api.GET as Mock).mockImplementation(
    async (
      path: string,
      options?: { params?: { path?: { product_id?: string } } },
    ) => {
      if (path.endsWith("/custom-dishes")) {
        return {
          data: { items: dishes, total: dishes.length },
          response: { status: 200 },
        };
      }
      if (path.endsWith("{product_id}")) {
        return {
          data: PRODUCTS[options?.params?.path?.product_id ?? ""],
          response: { status: 200 },
        };
      }
      if (path.endsWith("/overview")) {
        return {
          data: { patient_id: SESSION.patientId, prescription: null },
          response: { status: 200 },
        };
      }
      if (path.endsWith("/prescriptions/on")) {
        return { data: { prescription: null }, response: { status: 200 } };
      }
      if (path.endsWith("/menus")) {
        return { response: { status: 404 } };
      }
      return { data: { items: [], total: 0 }, response: { status: 200 } };
    },
  );
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<DishesScreen session={SESSION} />, { wrapper: Wrapper });
}

async function openCard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("radio", { name: "Блюда ребёнка" }));
  await user.click(await screen.findByRole("button", { name: /Омлет Амины/ }));
  return screen.findByRole("heading", { level: 2, name: "Омлет Амины" });
}

beforeEach(() => {
  vi.clearAllMocks();
  dishes = [DISH];
  serve();
  (api.POST as Mock).mockImplementation(() => new Promise(() => undefined));
  (api.DELETE as Mock).mockResolvedValue({ response: { status: 204 } });
});

describe("карточка блюда ребёнка (Б1)", () => {
  it("показатели, что взвесить и как готовить — граммы с сервера", async () => {
    const user = userEvent.setup();
    renderScreen();

    const title = await openCard(user);
    const card = title.closest("section") as HTMLElement;

    // Значок нейтральный — сверки с назначением у блюда нет (М4).
    expect(card.querySelector("[data-state]")).toHaveAttribute(
      "data-state",
      "neutral",
    );
    expect(within(card).getByText("310 ккал")).toBeInTheDocument();
    expect(await within(card).findByText("Яйцо куриное")).toBeInTheDocument();
    expect(within(card).getByText("52,5 г")).toBeInTheDocument();
    const salt = within(card).getByText("Соль").closest("li") as HTMLElement;
    expect(salt).toHaveTextContent("приправа, не учитывается");
    // Граммы — в своём столбце справа и основным цветом (у плиты по ним
    // взвешивают); строка целиком не переносится.
    const grams = within(card).getByText("52,5 г");
    expect(grams.closest("li")).not.toHaveClass("flex-wrap");
    expect(grams).toHaveClass("shrink-0", "text-foreground");
    // Продуктов из архива нет — и пометки нет.
    expect(within(card).queryByText("в архиве")).toBeNull();
    expect(
      within(card).getByRole("heading", { name: "Как готовить" }),
    ).toBeInTheDocument();
    expect(card).toHaveTextContent("Жарить на масле.");
    expect(
      within(card).getByRole("heading", { name: "Добавить в меню" }),
    ).toBeInTheDocument();
  });

  it("«Назад» Telegram закрывает карточку, а не приложение", async () => {
    const user = userEvent.setup();
    renderScreen();
    await openCard(user);

    const [onBack] = showBackButton.mock.calls.at(-1) as [() => void];
    act(() => {
      onBack();
    });

    expect(
      screen.queryByRole("heading", { level: 2, name: "Омлет Амины" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /Омлет Амины/ }),
    ).toBeInTheDocument();
  });

  it("удаление спрашивает, называя блюдо, и говорит, что станет с днями", async () => {
    const user = userEvent.setup();
    renderScreen();
    await openCard(user);

    await user.click(screen.getByRole("button", { name: "Удалить блюдо" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Удалить блюдо «Омлет Амины»?",
    });
    expect(dialog).toHaveTextContent("останутся название и граммы");
    // Сервер оставляет такие дни изменяемыми — так и сказано, а не только
    // «граммы останутся».
    expect(dialog).toHaveTextContent("эти дни можно менять как прежде");
    // Опасное подтверждение — красное, а не основная синяя кнопка.
    expect(
      within(dialog).getByRole("button", { name: "Удалить блюдо" }),
    ).toHaveAttribute("data-variant", "destructive");

    dishes = [];
    await user.click(
      within(dialog).getByRole("button", { name: "Удалить блюдо" }),
    );

    await waitFor(() => {
      expect(api.DELETE).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/custom-dishes/{dish_id}",
        { params: { path: { patient_id: SESSION.patientId, dish_id: "d1" } } },
      );
    });
    expect(await screen.findByText("Блюд ребёнка пока нет")).toBeVisible();
  });

  it("«Открыть в расчёте» переносит состав блюда в расчёт", async () => {
    const user = userEvent.setup();
    renderScreen();
    await openCard(user);

    await user.click(screen.getByRole("button", { name: "Открыть в расчёте" }));

    expect(screen.getByRole("radio", { name: "Расчёт" })).toBeChecked();
    expect(await screen.findByLabelText(/Яйцо куриное, граммы/)).toHaveValue(
      "52,5",
    );
    expect(screen.getByLabelText(/Соль, граммы/)).toHaveValue("0,5");
  });

  it("продукт из архива назван в карточке блюда, как в карточке рецепта", async () => {
    PRODUCTS.p9 = {
      ...(PRODUCTS.p1 as object),
      id: "p9",
      name_ru: "Сливки старые",
      is_active: false,
    };
    dishes = [
      {
        ...DISH,
        ingredients: [...DISH.ingredients, { product_id: "p9", grams: 20 }],
      },
    ];
    try {
      const user = userEvent.setup();
      renderScreen();
      const card = (await openCard(user)).closest("section") as HTMLElement;

      expect(
        await within(card).findByText("В составе есть продукт из архива"),
      ).toBeInTheDocument();
      expect(card).toHaveTextContent("В архиве: Сливки старые.");
      expect(
        within(card).getByText("Сливки старые").closest("li"),
      ).toHaveTextContent("в архиве");
    } finally {
      delete PRODUCTS.p9;
    }
  });

  it("вопрос «заменить собранное?» ждёт, пока расчёт снова покажут", async () => {
    // Окно уходит порталом в body: на скрытом разделе оно открылось бы поверх
    // рецептов, и «Назад» Telegram его бы не закрыл.
    let arrive: (value: unknown) => void = () => undefined;
    const late = new Promise((resolve) => {
      arrive = resolve;
    });
    PRODUCTS.p8 = { ...(PRODUCTS.p1 as object), id: "p8", name_ru: "Сыр" };
    dishes = [
      DISH,
      {
        ...DISH,
        id: "d2",
        title: "Сырники",
        ingredients: [{ product_id: "p8", grams: 30 }],
        computed: null,
      },
    ];
    const served = (api.GET as Mock).getMockImplementation() as (
      path: string,
      options?: { params?: { path?: { product_id?: string } } },
    ) => Promise<unknown>;
    (api.GET as Mock).mockImplementation(
      (
        path: string,
        options?: { params?: { path?: { product_id?: string } } },
      ) =>
        options?.params?.path?.product_id === "p8"
          ? late
          : served(path, options),
    );
    try {
      const user = userEvent.setup();
      renderScreen();
      await openCard(user);
      await user.click(
        screen.getByRole("button", { name: "Открыть в расчёте" }),
      );
      await screen.findByLabelText(/Яйцо куриное, граммы/);

      await user.click(screen.getByRole("radio", { name: "Блюда ребёнка" }));
      await user.click(
        screen.getByRole("button", { name: "К блюдам ребёнка" }),
      );
      await user.click(await screen.findByRole("button", { name: /Сырники/ }));
      await user.click(
        await screen.findByRole("button", { name: "Открыть в расчёте" }),
      );
      // Карточки продуктов ещё в пути — человек ушёл к рецептам.
      await user.click(screen.getByRole("radio", { name: "Рецепты" }));
      await act(async () => {
        arrive({ data: PRODUCTS.p8, response: { status: 200 } });
        await late;
      });

      expect(screen.queryByRole("alertdialog")).toBeNull();

      await user.click(screen.getByRole("radio", { name: "Расчёт" }));
      expect(
        await screen.findByRole("alertdialog", {
          name: "Заменить состав в расчёте блюдом «Сырники»?",
        }),
      ).toBeInTheDocument();
    } finally {
      delete PRODUCTS.p8;
    }
  });
});
