import { NetworkError } from "@ketocare/api-client";
import { Toaster } from "@ketocare/ui";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import calculatorRu from "../../locales/ru/calculator.json";
import doctorRu from "../../locales/ru/doctor.json";
import { SectionRouter } from "../../test/SectionRouter";
import { HandOffToPatient } from "./HandOffToPatient";
import type { DishRow } from "./types";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "calculator", calculatorRu, true, true);
i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const DISH_ID = "33333333-3333-4333-8333-333333333333";

const PATIENTS = [
  {
    id: PATIENT_ID,
    full_name: "Иван Петров",
    birth_date: "2020-05-14",
    sex: "m",
    height_cm: 108,
    allergies: [],
    notes: null,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    full_name: "Анна Сидорова",
    birth_date: "2018-02-03",
    sex: "f",
    height_cm: 124,
    allergies: [],
    notes: null,
  },
];

const ROWS: DishRow[] = [
  {
    product: {
      id: PRODUCT_ID,
      name_ru: "Кокосовое масло",
      kcal_100g: 899,
      fat_100g: 99.9,
      protein_100g: 0,
      carbs_100g: 0,
      fiber_100g: 0,
    } as unknown as DishRow["product"],
    grams: 30,
  },
];

function renderHandOff(blockedBy: string | null = null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="calculator">{children}</SectionRouter>
        <Toaster />
      </QueryClientProvider>
    );
  }

  return render(<HandOffToPatient rows={ROWS} blockedBy={blockedBy} />, {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  (api.GET as Mock).mockImplementation((path: string, options: unknown) => {
    if (path === "/api/v1/patients") {
      const q = (options as { params?: { query?: { q?: string } } }).params
        ?.query?.q;
      const items =
        q === undefined
          ? PATIENTS
          : PATIENTS.filter((patient) =>
              patient.full_name.toLowerCase().includes(q.toLowerCase()),
            );
      return Promise.resolve({ data: { items, total: items.length } });
    }
    return Promise.resolve({ data: { items: [], total: 0 } });
  });

  (api.POST as Mock).mockResolvedValue({
    data: { id: DISH_ID, title: "Завтрак 4:1" },
  });
});

describe("передача состава пациенту", () => {
  it("не даёт передать, пока не названы блюдо и ребёнок", async () => {
    // Отправлять нечего, и отказ после нажатия был бы лишним шагом.
    renderHandOff();

    expect(
      await screen.findByRole("button", { name: "Передать" }),
    ).toBeDisabled();
  });

  it("ищет пациента на сервере, а не листает когорту", async () => {
    // Ради этого всё и затевалось: прежний выбор рисовал пятьдесят кнопок в
    // алфавитном порядке, и поиска в нём не было вовсе.
    const user = userEvent.setup();
    renderHandOff();

    await user.click(
      await screen.findByRole("button", { name: /Выбрать пациента/ }),
    );
    await user.type(
      await screen.findByPlaceholderText("Поиск по имени"),
      "сидор",
    );

    await waitFor(() => {
      expect(api.GET).toHaveBeenCalledWith(
        "/api/v1/patients",
        expect.objectContaining({
          params: expect.objectContaining({
            query: expect.objectContaining({ q: "сидор" }),
          }),
        }),
      );
    });
  });

  it("сохраняет состав в блюда выбранного ребёнка", async () => {
    // «Передать» — это блюдо в карте ребёнка, а не назначение: назначение это
    // соотношение и лимиты, и живёт оно в своём разделе.
    const user = userEvent.setup();
    renderHandOff();

    await user.type(
      await screen.findByLabelText("Название блюда"),
      "Завтрак 4:1",
    );
    await user.click(screen.getByRole("button", { name: /Выбрать пациента/ }));
    await user.click(
      await screen.findByRole("option", { name: /Иван Петров/ }),
    );
    await user.click(screen.getByRole("button", { name: "Передать" }));

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/custom-dishes",
        expect.objectContaining({
          params: { path: { patient_id: PATIENT_ID } },
          body: expect.objectContaining({
            title: "Завтрак 4:1",
            ingredients: [{ product_id: PRODUCT_ID, grams: 30 }],
          }),
        }),
      );
    });
  });

  it("без сети передача не встаёт в очередь: отказ сразу и без второго блюда потом", async () => {
    // Запись на паузе создала бы блюдо молча после возврата связи — возможно,
    // уже с закрытого экрана, — а повторное нажатие дало бы дубль.
    (api.POST as Mock).mockRejectedValue(new NetworkError());
    const user = userEvent.setup();
    renderHandOff();

    await user.type(
      await screen.findByLabelText("Название блюда"),
      "Завтрак 4:1",
    );
    await user.click(screen.getByRole("button", { name: /Выбрать пациента/ }));
    await user.click(
      await screen.findByRole("option", { name: /Иван Петров/ }),
    );

    try {
      act(() => {
        onlineManager.setOnline(false);
      });
      await user.click(screen.getByRole("button", { name: "Передать" }));

      expect(
        await screen.findByText("Нет связи с сервером. Проверьте подключение."),
      ).toBeInTheDocument();
      expect(api.POST).toHaveBeenCalledTimes(1);

      act(() => {
        onlineManager.setOnline(true);
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(api.POST).toHaveBeenCalledTimes(1);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("ошибка в коде не выдаётся за «нет связи», а сообщение сервера важнее", async () => {
    // `TypeError` бросает и ошибка в коде: назвать её «нет связи» значило бы
    // отправить человека проверять сеть при исправной сети.
    (api.POST as Mock)
      .mockRejectedValueOnce(new TypeError("x is not a function"))
      .mockResolvedValueOnce({
        error: {
          error: { code: "conflict", message: "Такое блюдо уже есть." },
        },
      });
    const user = userEvent.setup();
    renderHandOff();

    await user.type(
      await screen.findByLabelText("Название блюда"),
      "Завтрак 4:1",
    );
    await user.click(screen.getByRole("button", { name: /Выбрать пациента/ }));
    await user.click(
      await screen.findByRole("option", { name: /Иван Петров/ }),
    );

    await user.click(screen.getByRole("button", { name: "Передать" }));
    expect(
      await screen.findByText("Что-то пошло не так. Попробуйте ещё раз."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Нет связи/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Передать" }));
    expect(
      await screen.findByText("Такое блюдо уже есть."),
    ).toBeInTheDocument();
  });

  it("состав, который нельзя передать, не уходит и в обход кнопки", async () => {
    // Кнопка выключена причиной сверху (например, масса тяжелее предела), но
    // форма — последняя проверка: отправка мимо кнопки её не миновала бы.
    const user = userEvent.setup();
    renderHandOff("Масса продукта «Кокосовое масло» больше 5000 г.");

    await user.type(
      await screen.findByLabelText("Название блюда"),
      "Завтрак 4:1",
    );
    await user.click(screen.getByRole("button", { name: /Выбрать пациента/ }));
    await user.click(
      await screen.findByRole("option", { name: /Иван Петров/ }),
    );

    const handOff = screen.getByRole("button", { name: "Передать" });
    expect(handOff).toBeDisabled();
    fireEvent.submit(handOff.closest("form") as HTMLFormElement);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(api.POST).not.toHaveBeenCalled();
  });
});
