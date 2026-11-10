import { Toaster } from "@ketocare/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import recipesRu from "../../locales/ru/recipes.json";
import { RecipeFitSheet } from "./RecipeFitSheet";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "recipes", recipesRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const RECIPE = {
  id: "r1",
  title: "Курица с брокколи",
  status: "published",
  computed: { ratio: 4 },
};
const DRAFT = { ...RECIPE, id: "r2", title: "Черновик", status: "draft" };

const FITTED = {
  recipe_id: "r1",
  title: "Курица с брокколи",
  status: "fitted",
  reason: null,
  reshaped: false,
  withdrawn: [],
  ingredients: [{ product_id: "p1", name_ru: "Курица", grams: 26 }],
  dish: {
    kcal: 298,
    fat_g: 30,
    protein_g: 8,
    carbs_g: 1,
    fiber_g: 0,
    ratio: 3.43,
  },
  ratio_within_tolerance: true,
  kcal_within_tolerance: true,
};
const REFUSED = {
  recipe_id: "r3",
  title: "С арахисом",
  status: "excluded",
  reason: "Исключено этому ребёнку: Арахис.",
  ingredients: [],
  dish: null,
};

function respond(items: unknown[]) {
  (api.POST as Mock).mockImplementation((path: string) => {
    if (path.endsWith("/recipe-fits")) {
      return Promise.resolve({
        data: {
          target_ratio: 3.5,
          target_kcal: 300,
          engine_version: "1.3.0",
          items,
        },
      });
    }
    return Promise.resolve({ data: { id: "d1" } });
  });
}

async function openReview() {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecipeFitSheet patientId={PATIENT_ID} />
      <Toaster />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: /Из библиотеки/ }));
  await user.click(
    await screen.findByRole("checkbox", { name: /Курица с брокколи/ }),
  );
  await user.click(screen.getByRole("button", { name: /Подогнать/ }));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockResolvedValue({
    data: { items: [RECIPE, DRAFT], total: 2 },
  });
  respond([FITTED, REFUSED]);
});

describe("блюда из библиотеки", () => {
  it("не предлагает черновики", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RecipeFitSheet patientId={PATIENT_ID} />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Из библиотеки/ }));

    await screen.findByRole("checkbox", { name: /Курица с брокколи/ });
    expect(screen.queryByRole("checkbox", { name: /Черновик/ })).toBeNull();
  });

  it("показывает подгонку и причину отказа, ничего не записывая", async () => {
    await openReview();

    expect(await screen.findByText("26 г")).toBeInTheDocument();
    expect(
      screen.getByText("Исключено этому ребёнку: Арахис."),
    ).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledTimes(1);
  });

  it("сохраняет выбранное обычной ручкой с ключом попытки", async () => {
    const user = await openReview();

    await screen.findByText("26 г");
    await user.click(screen.getByRole("button", { name: /Сохранить ребёнку/ }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
    const [path, options] = (api.POST as Mock).mock.calls[1]!;
    expect(path).toBe("/api/v1/patients/{patient_id}/custom-dishes");
    expect(options.body).toEqual({
      title: "Курица с брокколи",
      ingredients: [{ product_id: "p1", grams: 26 }],
      reject_excluded: true,
    });
    expect(options.params.header["Idempotency-Key"]).toEqual(
      expect.any(String),
    );
  });

  it("у отказанного рецепта нет выбора", async () => {
    await openReview();

    const card = (await screen.findByText("С арахисом")).closest("li");
    expect(within(card as HTMLElement).queryByRole("checkbox")).toBeNull();
  });
});
