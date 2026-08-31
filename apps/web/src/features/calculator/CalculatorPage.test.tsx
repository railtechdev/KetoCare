import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import calculatorRu from "../../locales/ru/calculator.json";
import { SectionRouter } from "../../test/SectionRouter";
import { CalculatorPage } from "./CalculatorPage";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "calculator", calculatorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const BUTTER = "22222222-2222-4222-8222-222222222222";

const PRESCRIBED_RATIO = 3.5;

/** Задержка автопересчёта (400 мс) плюс запас: findBy по умолчанию ждёт 1 с. */
const AUTO_CALC_TIMEOUT_MS = 3000;

const OVERVIEW = {
  patient_id: PATIENT_ID,
  date: new Date().toISOString().slice(0, 10),
  prescription: {
    id: "p1",
    patient_id: PATIENT_ID,
    ratio: PRESCRIBED_RATIO,
    kcal_per_day: 1200,
    protein_min_g: 12,
    carbs_max_g: 35,
    meals_per_day: 3,
    starts_on: "2026-08-01",
    created_at: "2026-08-01T10:00:00Z",
  },
  day: null,
  last_ketone: null,
  last_weight: null,
  seizures_today: { entries: 0, count: 0 },
};

const PRODUCTS = {
  items: [
    {
      id: BUTTER,
      name_ru: "Масло сливочное",
      kcal_100g: 748,
      fat_100g: 82.5,
      protein_100g: 0.5,
      carbs_100g: 0.8,
      fiber_100g: 0,
    },
  ],
  total: 1,
};

const VERIFIED = {
  dish: {
    kcal: 374,
    fat_g: 41.25,
    protein_g: 0.25,
    carbs_g: 0.4,
    fiber_g: 0,
    ratio: 63.5,
    engine_version: "1.0.0",
    items: [{ product_id: BUTTER, grams: 50 }],
  },
  ratio_within_tolerance: false,
  kcal_within_tolerance: false,
  engine_version: "1.0.0",
};

const SOLVED = {
  dish: {
    kcal: 400,
    fat_g: 44,
    protein_g: 0.3,
    carbs_g: 0.4,
    fiber_g: 0,
    ratio: PRESCRIBED_RATIO,
    engine_version: "1.0.0",
    items: [{ product_id: BUTTER, grams: 29 }],
  },
  ratio_within_tolerance: true,
  kcal_within_tolerance: true,
  engine_version: "1.0.0",
};

function renderCalculator() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="calculator">{children}</SectionRouter>
      </QueryClientProvider>
    );
  }

  return render(<CalculatorPage patientId={PATIENT_ID} />, {
    wrapper: Wrapper,
  });
}

async function addButter(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Добавить продукт/), "масло");
  await user.click(await screen.findByRole("option", { name: /Масло/ }));
}

describe("калькулятор", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.GET as Mock).mockImplementation(async (path: string) =>
      path.includes("overview")
        ? { data: OVERVIEW, error: undefined }
        : { data: PRODUCTS, error: undefined },
    );
    (api.POST as Mock).mockImplementation(async (path: string) => ({
      data: path.includes("solve") ? SOLVED : VERIFIED,
      error: undefined,
    }));
  });

  it("берёт кетосоотношение из активного назначения, а не из кода экрана", async () => {
    renderCalculator();

    // До этого в поле стояла четвёрка, зашитая во фронтенде, и вердикт
    // «выходит за допуски назначения» выносился относительно чужой цели.
    const ratio = await screen.findByLabelText(/Кетосоотношение/);
    await waitFor(() => expect(ratio).toHaveValue(PRESCRIBED_RATIO));
    expect(
      screen.getByText(/Из активного назначения ребёнка/),
    ).toBeInTheDocument();
  });

  it("считает сам, без нажатия кнопки", async () => {
    const user = userEvent.setup();
    renderCalculator();
    await addButter(user);

    // «Добавляю продукты — ничего не происходит»: расчёт запускала кнопка,
    // которая на ноутбуке стояла ниже сгиба, а на телефоне — тем более.
    expect(
      await screen.findByText("Сохранить как моё блюдо", undefined, {
        timeout: AUTO_CALC_TIMEOUT_MS,
      }),
    ).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/calc/verify",
      expect.anything(),
    );

    // И кнопки в этом режиме нет: она обещала бы действие, которое уже
    // произошло.
    expect(
      screen.queryByRole("button", { name: /^Рассчитать/ }),
    ).not.toBeInTheDocument();
  });

  it("снимает вердикт, пока пересчёт не догнал новую цель", async () => {
    const user = userEvent.setup();
    renderCalculator();
    await addButter(user);

    expect(
      await screen.findByText(/выходит за допуски/, undefined, {
        timeout: AUTO_CALC_TIMEOUT_MS,
      }),
    ).toBeInTheDocument();

    // Вердикт от прежней цели рядом с новым числом в поле опаснее обычной
    // устаревшей выдачи: по нему готовят еду ребёнку. Само число остаётся —
    // гасить его на каждое нажатие значит очищать экран, по которому сверяются.
    const ratio = screen.getByLabelText(/Кетосоотношение/);
    await user.clear(ratio);

    await waitFor(() =>
      expect(screen.queryByText(/выходит за допуски/)).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/374 ккал/)).toBeInTheDocument();
  });

  it("переносит подобранные массы в состав, оставляя их редактируемыми", async () => {
    const user = userEvent.setup();
    renderCalculator();
    await addButter(user);

    await user.click(screen.getByRole("tab", { name: /Подобрать/ }));
    await user.click(screen.getByRole("button", { name: /^Рассчитать/ }));

    // Иначе из режима «подобрать» вёл один выход — сохранить как есть:
    // округлить под кухонные весы, проверить или пересчитать было нельзя.
    const grams = await screen.findByLabelText(
      /Масса продукта «Масло сливочное»/,
    );
    await waitFor(() => expect(grams).toHaveValue(29));
    expect(grams).not.toHaveAttribute("readonly");
  });
});
