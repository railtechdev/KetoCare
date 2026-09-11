import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import calculatorRu from "../../locales/ru/calculator.json";
import { SectionRouter } from "../../test/SectionRouter";
import { CalculatorPage, CalculatorView } from "./CalculatorPage";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "calculator", calculatorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PATIENT_ID = "33333333-3333-4333-8333-333333333333";
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
  seizure_trend: { recent: 0, previous: 0, grew: null, appeared: false },
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
    net_carbs_g: 0.4,
    ratio: 63.5,
    engine_version: "1.0.0",
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
    net_carbs_g: 0.4,
    ratio: PRESCRIBED_RATIO,
    engine_version: "1.0.0",
    items: [
      {
        product_id: BUTTER,
        grams: 29,
        kcal: 400,
        fat_g: 44,
        protein_g: 0.3,
        carbs_g: 0.4,
        fiber_g: 0,
      },
    ],
  },
  ratio_within_tolerance: true,
  kcal_within_tolerance: true,
  engine_version: "1.0.0",
};

/**
 * Значение по умолчанию здесь не годится: оно подставляется и на явный
 * `undefined`, то есть «калькулятор без ребёнка» молча превращался бы в
 * калькулятор с ребёнком, а тест — в проверку того же, что и соседний.
 */
function renderCalculator(patientId?: string) {
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

  return render(<CalculatorPage patientId={patientId} />, {
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
    renderCalculator(PATIENT_ID);

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
    renderCalculator(PATIENT_ID);
    await addButter(user);

    // «Добавляю продукты — ничего не происходит»: расчёт запускала кнопка,
    // которая на ноутбуке стояла ниже сгиба, а на телефоне — тем более.
    // Ждём сами показатели: форма сохранения стоит, пока есть состав, и о
    // расчёте не говорит ничего.
    expect(
      await screen.findByText(/374 ккал/, undefined, {
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

  it("показывает вклад каждой позиции числами сервера", async () => {
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);

    // По итогу блюда видно только, что оно мимо цели; что именно менять —
    // видно по вкладу строки. Числа приходят с сервера: умножать состав на
    // граммы в браузере — второй источник клинических чисел.
    const contribution = await screen.findByRole(
      "group",
      { name: /Вклад продукта «Масло сливочное»/ },
      { timeout: AUTO_CALC_TIMEOUT_MS },
    );
    expect(contribution).toHaveTextContent("374");
    expect(contribution).toHaveTextContent("41.3");
    expect(contribution).toHaveTextContent("Жиры, г");
    expect(contribution).not.toHaveAttribute("aria-busy", "true");

    // Правка граммовки не гасит числа строки, а помечает их устаревшими —
    // так же, как итог блюда.
    await user.type(screen.getByLabelText(/Масса продукта/), "0");
    expect(
      screen.getByRole("group", { name: /Вклад продукта/ }),
    ).toHaveAttribute("aria-busy", "true");
  });

  it("снимает вердикт, пока пересчёт не догнал новую цель", async () => {
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);

    // Состояние сказано словом рядом с числами, а не плашкой-тревогой: пока
    // блюдо собирают, оно почти всегда мимо цели.
    expect(
      await screen.findByText("Цель не достигнута", undefined, {
        timeout: AUTO_CALC_TIMEOUT_MS,
      }),
    ).toBeInTheDocument();

    // Вердикт от прежней цели рядом с новым числом в поле опаснее обычной
    // устаревшей выдачи: по нему готовят еду ребёнку. Само число остаётся —
    // гасить его на каждое нажатие значит очищать экран, по которому сверяются.
    const ratio = screen.getByLabelText(/Кетосоотношение/);
    await user.clear(ratio);

    await waitFor(() =>
      expect(screen.queryByText("Цель не достигнута")).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/374 ккал/)).toBeInTheDocument();
  });

  it("говорит, почему показателей нет, когда проверка отказала", async () => {
    // Отказ проверки не показывался вовсе: после пересчёта порций в массы,
    // которые расчёт уже не принимает, показатели молча исчезали.
    (api.POST as Mock).mockImplementation(async (path: string) =>
      path.includes("verify")
        ? {
            data: undefined,
            error: {
              error: {
                code: "validation_error",
                message: "Проверьте правильность заполнения полей.",
              },
            },
          }
        : { data: SOLVED, error: undefined },
    );
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);

    expect(
      await screen.findByText(
        "Проверьте правильность заполнения полей.",
        undefined,
        { timeout: AUTO_CALC_TIMEOUT_MS },
      ),
    ).toBeInTheDocument();

    // Отказ относится к прежнему составу: после правки он не висит рядом с
    // новым числом в поле, пока пересчёт не догнал.
    await user.type(screen.getByLabelText(/Масса продукта/), "0");
    expect(
      screen.queryByText("Проверьте правильность заполнения полей."),
    ).not.toBeInTheDocument();
  });

  it("сбой проверки можно повторить — без фиктивной правки состава", async () => {
    // Сбой сервера или сети проходит сам, а повторить проверку было нечем:
    // показатели и сохранение ждали её, и выход был один — поменять граммы.
    let verifyCalls = 0;
    (api.POST as Mock).mockImplementation(async (path: string) => {
      if (!path.includes("verify")) return { data: SOLVED, error: undefined };
      verifyCalls += 1;
      return verifyCalls === 1
        ? {
            data: undefined,
            error: {
              error: {
                code: "internal",
                message: "Внутренняя ошибка сервера.",
              },
            },
          }
        : { data: VERIFIED, error: undefined };
    });
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Повторить" },
        {
          timeout: AUTO_CALC_TIMEOUT_MS,
        },
      ),
    );

    expect(await screen.findByText(/374 ккал/)).toBeInTheDocument();
    expect(verifyCalls).toBe(2);
    expect(
      screen.queryByText("Внутренняя ошибка сервера."),
    ).not.toBeInTheDocument();
  });

  it("на время повтора отказ и кнопка остаются, фокус не теряется", async () => {
    // Кнопка размонтировалась по клику, и фокус уходил в начало страницы, а
    // на месте ошибки было пусто, пока шёл запрос.
    let verifyCalls = 0;
    (api.POST as Mock).mockImplementation((path: string) => {
      if (!path.includes("verify")) {
        return Promise.resolve({ data: SOLVED, error: undefined });
      }
      verifyCalls += 1;
      return verifyCalls === 1
        ? Promise.resolve({
            data: undefined,
            error: {
              error: {
                code: "internal",
                message: "Внутренняя ошибка сервера.",
              },
            },
          })
        : new Promise(() => {});
    });
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Повторить" },
        {
          timeout: AUTO_CALC_TIMEOUT_MS,
        },
      ),
    );

    const busy = await screen.findByRole("button", { name: "Повторяем…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveFocus();
    expect(screen.getByText("Внутренняя ошибка сервера.")).toBeInTheDocument();
  });

  it("сетевой сбой — ответа нет вовсе — тоже можно повторить", async () => {
    // У ошибки сети нет кода в теле: это и есть главный повод для кнопки.
    let verifyCalls = 0;
    (api.POST as Mock).mockImplementation((path: string) => {
      if (!path.includes("verify")) {
        return Promise.resolve({ data: SOLVED, error: undefined });
      }
      verifyCalls += 1;
      return verifyCalls === 1
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve({ data: VERIFIED, error: undefined });
    });
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Повторить" },
        {
          timeout: AUTO_CALC_TIMEOUT_MS,
        },
      ),
    );

    expect(await screen.findByText(/374 ккал/)).toBeInTheDocument();
  });

  it("после успешного повтора в карте ребёнка снова можно сохранить", async () => {
    // Сохранение ждёт ответа проверки на этот самый состав — повтор обязан его
    // дать, иначе кнопка «Повторить» вела бы в тот же тупик.
    let verifyCalls = 0;
    (api.POST as Mock).mockImplementation((path: string) => {
      if (!path.includes("verify")) {
        return Promise.resolve({ data: SOLVED, error: undefined });
      }
      verifyCalls += 1;
      return verifyCalls === 1
        ? Promise.resolve({
            data: undefined,
            error: {
              error: {
                code: "internal",
                message: "Внутренняя ошибка сервера.",
              },
            },
          })
        : Promise.resolve({ data: VERIFIED, error: undefined });
    });
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);
    await user.type(screen.getByLabelText(/Название блюда/), "Суп");
    const save = screen.getByRole("button", { name: "Сохранить" });
    expect(save).toBeDisabled();

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Повторить" },
        {
          timeout: AUTO_CALC_TIMEOUT_MS,
        },
      ),
    );

    await waitFor(() => expect(save).toBeEnabled(), {
      timeout: AUTO_CALC_TIMEOUT_MS,
    });
  });

  it("правка ввода во время повтора не оставляет «Повторяем…» и прежний отказ", async () => {
    // Новый запуск проверки стирал колбэк завершения повтора, и кнопка
    // зависала навсегда рядом со свежими показателями.
    let verifyCalls = 0;
    (api.POST as Mock).mockImplementation((path: string) => {
      if (!path.includes("verify")) {
        return Promise.resolve({ data: SOLVED, error: undefined });
      }
      verifyCalls += 1;
      return verifyCalls === 1
        ? Promise.resolve({
            data: undefined,
            error: {
              error: {
                code: "internal",
                message: "Внутренняя ошибка сервера.",
              },
            },
          })
        : new Promise(() => {});
    });
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);
    await user.click(
      await screen.findByRole(
        "button",
        { name: "Повторить" },
        {
          timeout: AUTO_CALC_TIMEOUT_MS,
        },
      ),
    );
    await screen.findByRole("button", { name: "Повторяем…" });

    await user.type(screen.getByLabelText(/Масса продукта/), "0");
    await waitFor(() => expect(verifyCalls).toBe(3), {
      timeout: AUTO_CALC_TIMEOUT_MS,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      screen.queryByRole("button", { name: "Повторяем…" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Внутренняя ошибка сервера."),
    ).not.toBeInTheDocument();
  });

  it("повторный отказ с тем же текстом объявляется заново", async () => {
    (api.POST as Mock).mockImplementation(async (path: string) =>
      path.includes("verify")
        ? {
            data: undefined,
            error: {
              error: {
                code: "internal",
                message: "Внутренняя ошибка сервера.",
              },
            },
          }
        : { data: SOLVED, error: undefined },
    );
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);

    await user.click(
      await screen.findByRole(
        "button",
        { name: "Повторить" },
        {
          timeout: AUTO_CALC_TIMEOUT_MS,
        },
      ),
    );

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((el) => el.textContent === "Внутренняя ошибка сервера."),
      ).toBe(true),
    );
  });

  it("отказ проверки по данным повторить не предлагает", async () => {
    // Тот же состав откажут так же: кнопка обещала бы то, чего не будет.
    (api.POST as Mock).mockImplementation(async (path: string) =>
      path.includes("verify")
        ? {
            data: undefined,
            error: {
              error: {
                code: "validation_error",
                message: "Проверьте правильность заполнения полей.",
              },
            },
          }
        : { data: SOLVED, error: undefined },
    );
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);

    await screen.findByText(
      "Проверьте правильность заполнения полей.",
      undefined,
      { timeout: AUTO_CALC_TIMEOUT_MS },
    );
    expect(
      screen.queryByRole("button", { name: "Повторить" }),
    ).not.toBeInTheDocument();
  });

  it("один и тот же отказ показывается одной строкой", async () => {
    // Больше 5000 г руками: проверка и пересчёт отказывают одним текстом, и две
    // одинаковые строки ошибки подряд нарушали правило П27.
    const message = "Проверьте правильность заполнения полей.";
    (api.POST as Mock).mockImplementation(async (path: string) =>
      path.includes("verify") || path.includes("scale")
        ? {
            data: undefined,
            error: { error: { code: "validation_error", message } },
          }
        : { data: SOLVED, error: undefined },
    );
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);
    expect(
      await screen.findByText(message, undefined, {
        timeout: AUTO_CALC_TIMEOUT_MS,
      }),
    ).toBeInTheDocument();

    const factor = screen.getByLabelText("Коэффициент порции");
    await user.clear(factor);
    await user.type(factor, "2");
    await user.click(
      screen.getByRole("button", { name: /Пересчитать порции/ }),
    );

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/calc/scale",
        expect.anything(),
      ),
    );
    expect(screen.getAllByText(message)).toHaveLength(1);
  });

  it("другая причина отказа действия видна рядом с отказом проверки", async () => {
    // Прятать отказ действия только потому, что проверка в ошибке, — значит
    // съесть другую причину: нажал «Пересчитать» — и ничего не произошло.
    (api.POST as Mock).mockImplementation(async (path: string) =>
      path.includes("verify")
        ? {
            data: undefined,
            error: {
              error: {
                code: "validation_error",
                message: "Проверьте правильность заполнения полей.",
              },
            },
          }
        : path.includes("scale")
          ? {
              data: undefined,
              error: {
                error: { code: "internal", message: "Сервер недоступен." },
              },
            }
          : { data: SOLVED, error: undefined },
    );
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);
    expect(
      await screen.findByText(
        "Проверьте правильность заполнения полей.",
        undefined,
        { timeout: AUTO_CALC_TIMEOUT_MS },
      ),
    ).toBeInTheDocument();

    const factor = screen.getByLabelText("Коэффициент порции");
    await user.clear(factor);
    await user.type(factor, "2");
    await user.click(
      screen.getByRole("button", { name: /Пересчитать порции/ }),
    );

    expect(await screen.findByText("Сервер недоступен.")).toBeInTheDocument();
  });

  it("убранный из состава продукт не оставляет своих чисел на экране", async () => {
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);
    expect(
      await screen.findByText(/374 ккал/, undefined, {
        timeout: AUTO_CALC_TIMEOUT_MS,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Убрать продукт/ }));

    // Показатели пустого состава — утверждение о блюде, которого на экране уже
    // нет. Пустой расчёт молчит: о пустоте сказано в блоке состава.
    await waitFor(() =>
      expect(screen.queryByText(/374 ккал/)).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByText("Сохранить как моё блюдо"),
    ).not.toBeInTheDocument();
  });

  it("исключённый продукт без имени назван словами, а не идентификатором", async () => {
    // Mini App говорит здесь словами с самого начала; кабинет печатал 36
    // знаков UUID — одна семья, один продукт, два разных ответа.
    (api.POST as Mock).mockImplementation(async () => ({
      data: {
        ...VERIFIED,
        excluded: [{ product_id: "0f9b7c33-1111-4111-8111-222222222222" }],
      },
      error: undefined,
    }));
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);

    expect(
      await screen.findByText(/продукт удалён из справочника/, undefined, {
        timeout: AUTO_CALC_TIMEOUT_MS,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0f9b7c33/)).not.toBeInTheDocument();
  });

  it("называет продукты, снятые со входа подбора", async () => {
    // Подбор не предупреждает об исключённом, а вычёркивает его. Пока режимы
    // были вкладками, об этом говорил результат подбора; на одном экране
    // своего блока у результата нет — массы уезжают прямо в состав, и сказать
    // об этом больше негде. Строка в словаре осталась без места и молчала.
    (api.POST as Mock).mockImplementation(async (path: string) => ({
      data: path.includes("solve")
        ? { ...SOLVED, excluded: [{ product_id: "x", name_ru: "Арахис" }] }
        : VERIFIED,
      error: undefined,
    }));
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);

    await user.click(
      await screen.findByRole("button", { name: "Подобрать граммовку" }),
    );

    expect(
      await screen.findByText(/Не участвовало в подборе: Арахис/),
    ).toBeInTheDocument();
  });

  it("подбирает граммовку кнопкой и переносит массы в состав", async () => {
    // Подбор — действие над составом, а не отдельный режим: он перезаписывает
    // граммовку, поэтому остаётся кнопкой, но живёт на том же экране.
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);

    await user.click(
      await screen.findByRole("button", { name: /Подобрать граммовку/ }),
    );

    const grams = await screen.findByLabelText(
      /Масса продукта «Масло сливочное»/,
    );
    await waitFor(() => expect(grams).toHaveValue(29));
    expect(grams).not.toHaveAttribute("readonly");
  });

  it("подбор недоступен, пока не задана цель, и говорит об этом", async () => {
    // Подбирать граммовку не подо что: цель — вход этого действия. Но серая
    // кнопка без объяснения — это тупик: заказчица так и не дошла до подбора,
    // единственного, чего нет у программы, к которой она привыкла.
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);

    const kcal = await screen.findByLabelText(/Калорийность/);
    await user.clear(kcal);

    const solve = screen.getByRole("button", { name: /Подобрать граммовку/ });
    await waitFor(() => expect(solve).toBeDisabled());

    const reason = await screen.findByText(/Для подбора нужна цель/);
    expect(solve).toHaveAttribute("aria-describedby", reason.id);
  });

  it("пустой состав назван один раз на обе кнопки", async () => {
    // Строка на блок действий одна: при пустом составе причина у обеих кнопок
    // одна и та же, и два одинаковых абзаца подряд — второе сообщение об одном
    // и том же (правило П27), да ещё и озвученное дважды.
    renderCalculator(PATIENT_ID);

    const solve = await screen.findByRole("button", {
      name: /Подобрать граммовку/,
    });
    const scale = screen.getByRole("button", { name: /Пересчитать порции/ });
    expect(solve).toBeDisabled();
    expect(scale).toBeDisabled();

    const reason = screen.getByText("В составе нет продуктов.");
    expect(solve).toHaveAttribute("aria-describedby", reason.id);
    expect(scale).toHaveAttribute("aria-describedby", reason.id);
    expect(screen.queryByText(/Для подбора нужна цель/)).toBeNull();
  });

  it("масса тяжелее предела названа у поля и у кнопки и в расчёт не уходит", async () => {
    // Сервер не принимает позицию тяжелее 5000 г. До этой проверки показатели
    // пропадали, а на их месте стоял общий отказ — без слова о поле и пределе.
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);
    expect(
      await screen.findByText(/374 ккал/, undefined, {
        timeout: AUTO_CALC_TIMEOUT_MS,
      }),
    ).toBeInTheDocument();
    const title = screen.getByLabelText(/Название блюда/);
    await user.type(title, "Суп");

    const grams = screen.getByLabelText(/Масса продукта/);
    await user.clear(grams);
    await user.type(grams, "5001");

    const fieldError = screen.getByText(/Не больше 5000 г/);
    expect(grams).toHaveAttribute("aria-invalid", "true");
    expect(grams).toHaveAttribute("aria-describedby", fieldError.id);

    const scale = screen.getByRole("button", { name: /Пересчитать порции/ });
    expect(scale).toBeDisabled();
    // Причина одна и та же у пересчёта и у сохранения — две строки, по одной
    // на каждый блок действий.
    const reasons = screen
      .getAllByText("Масса продукта «Масло сливочное» больше 5000 г.")
      .map((element) => element.id);
    expect(reasons).toContain(scale.getAttribute("aria-describedby"));
    const save = screen.getByRole("button", { name: "Сохранить" });
    expect(save).toBeDisabled();
    expect(reasons).toContain(save.getAttribute("aria-describedby"));
    // Подбор граммов со входа не берёт — предел его не выключает.
    expect(
      screen.getByRole("button", { name: /Подобрать граммовку/ }),
    ).toBeEnabled();

    // Числа прежней массы уходят — они о другом блюде, — а тяжёлая масса на
    // сервер не отправляется вовсе.
    await waitFor(
      () => expect(screen.queryByText(/374 ккал/)).not.toBeInTheDocument(),
      { timeout: AUTO_CALC_TIMEOUT_MS },
    );
    const sent = (api.POST as Mock).mock.calls
      .filter(([path]) => String(path).includes("verify"))
      .map(([, options]) => options.body.items[0].grams);
    expect(sent).not.toContain(5001);

    // Форма сохранения не исчезала вместе с показателями: набранное название
    // на месте, и после исправления массы и нового расчёта сохранить снова можно.
    await user.clear(grams);
    await user.type(grams, "50");
    expect(screen.getByLabelText(/Название блюда/)).toHaveValue("Суп");
    await waitFor(
      () =>
        expect(screen.getByRole("button", { name: "Сохранить" })).toBeEnabled(),
      { timeout: AUTO_CALC_TIMEOUT_MS },
    );
  });

  it("в карте ребёнка сохранение ждёт проверки — она называет исключённое", async () => {
    // Сервер при сохранении исключённые ребёнку продукты не проверяет, а
    // предупреждение приходит только с ответом проверки. Форма видна сразу,
    // но состав, о котором проверка ещё ничего не сказала, не отправляется.
    (api.POST as Mock).mockImplementation((path: string) =>
      path.includes("verify")
        ? new Promise(() => {})
        : Promise.resolve({ data: SOLVED, error: undefined }),
    );
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);
    await user.type(screen.getByLabelText(/Название блюда/), "Суп");

    const save = screen.getByRole("button", { name: "Сохранить" });
    expect(save).toBeDisabled();
    const reason = await screen.findByText(/Сохранить можно после расчёта/);
    expect(save).toHaveAttribute("aria-describedby", reason.id);

    // Отправка в обход выключенной кнопки не проходит тоже: форма — последняя
    // проверка, сервер исключённое ребёнку при сохранении не сверяет.
    fireEvent.submit(save.closest("form") as HTMLFormElement);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      (api.POST as Mock).mock.calls.some(([path]) =>
        String(path).includes("custom-dishes"),
      ),
    ).toBe(false);
  });

  it("после правки состава сохранение не включается ни на миг до нового ответа", async () => {
    // Разрешение давал тайминг: через коммит после срабатывания задержки
    // состав считался проверенным, хотя запрос по нему ещё не ушёл, — и клик в
    // это окно сохранял непроверенное. Наблюдатель ловит само окно.
    let verifyCalls = 0;
    (api.POST as Mock).mockImplementation((path: string) => {
      if (!path.includes("verify")) {
        return Promise.resolve({ data: SOLVED, error: undefined });
      }
      verifyCalls += 1;
      return verifyCalls === 1
        ? Promise.resolve({ data: VERIFIED, error: undefined })
        : new Promise(() => {});
    });
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);
    await screen.findByText(/374 ккал/, undefined, {
      timeout: AUTO_CALC_TIMEOUT_MS,
    });
    await user.type(screen.getByLabelText(/Название блюда/), "Суп");
    const save = screen.getByRole("button", { name: "Сохранить" });
    expect(save).toBeEnabled();

    let enabledAfterEdit = false;
    const observer = new MutationObserver(() => {
      if (!save.hasAttribute("disabled")) enabledAfterEdit = true;
    });
    observer.observe(save, { attributes: true, attributeFilter: ["disabled"] });
    await user.type(screen.getByLabelText(/Масса продукта/), "0");
    // Сразу после правки: ответ был о другом составе. Наблюдатель ниже
    // ловит только переходы, и кнопка, не выключившаяся вовсе, прошла бы мимо.
    expect(save).toBeDisabled();

    await waitFor(() => expect(verifyCalls).toBe(2), {
      timeout: AUTO_CALC_TIMEOUT_MS,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    observer.disconnect();

    expect(enabledAfterEdit).toBe(false);
    expect(save).toBeDisabled();
  });

  it("ответ проверки о другом ребёнке не разрешает сохранить этому", async () => {
    // Сам экран калькулятора при смене пациента не пересоздаётся — это делают
    // обёртки маршрутов (`PatientViewRoute`, `PatientGate`). Разрешение на
    // сохранение сверяет ребёнка и без них. Пациент меняется состоянием внутри
    // роутера: `rerender` до экрана не доходит, роутер теста захватывает
    // содержимое один раз.
    (api.POST as Mock).mockImplementation((path: string) =>
      Promise.resolve({
        data: path.includes("verify") ? VERIFIED : SOLVED,
        error: undefined,
      }),
    );

    function SwitchablePatient() {
      const [patientId, setPatientId] = useState(PATIENT_ID);
      return (
        <>
          <button type="button" onClick={() => setPatientId(OTHER_PATIENT_ID)}>
            test: другой пациент
          </button>
          <CalculatorPage patientId={patientId} />
        </>
      );
    }
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <SectionRouter section="calculator">
          <SwitchablePatient />
        </SectionRouter>
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    await addButter(user);
    await screen.findByText(/374 ккал/, undefined, {
      timeout: AUTO_CALC_TIMEOUT_MS,
    });
    await user.type(screen.getByLabelText(/Название блюда/), "Суп");
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeEnabled();

    // Синхронно, без ожиданий: уведомление о новом запросе проверки приходит
    // таймером, и асинхронный клик успел бы его дождаться — тест прошёл бы на
    // одном тайминге, а не на сверке ребёнка.
    fireEvent.click(
      screen.getByRole("button", { name: "test: другой пациент" }),
    );

    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();

    // И не навсегда: ответ проверки по новому ребёнку снова разрешает сохранить.
    await waitFor(
      () =>
        expect(screen.getByRole("button", { name: "Сохранить" })).toBeEnabled(),
      { timeout: AUTO_CALC_TIMEOUT_MS },
    );
    const verifies = (api.POST as Mock).mock.calls.filter(([path]) =>
      String(path).includes("verify"),
    );
    expect(verifies.at(-1)?.[1]?.body?.patient_id).toBe(OTHER_PATIENT_ID);
  });

  it("отказ проверки не даёт сохранить и называет почему", async () => {
    (api.POST as Mock).mockImplementation(async (path: string) =>
      path.includes("verify")
        ? {
            data: undefined,
            error: {
              error: { code: "internal", message: "Сервис недоступен." },
            },
          }
        : { data: SOLVED, error: undefined },
    );
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);
    await user.type(screen.getByLabelText(/Название блюда/), "Суп");

    const reason = await screen.findByText(/Расчёт не прошёл/, undefined, {
      timeout: AUTO_CALC_TIMEOUT_MS,
    });
    const save = screen.getByRole("button", { name: "Сохранить" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("aria-describedby", reason.id);
  });

  it("причина не говорит о назначении: экран работает и без ребёнка", async () => {
    // Калькулятор специалиста открывается без выбранного пациента (ADR-0027),
    // и «у ребёнка нет назначения» было бы там утверждением о ком-то, кого он
    // не выбирал. О назначении говорят подпись поля и строка под целью.
    (api.GET as Mock).mockImplementation(async (path: string) =>
      path.includes("overview")
        ? { data: { ...OVERVIEW, prescription: null }, error: undefined }
        : { data: PRODUCTS, error: undefined },
    );
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);
    await addButter(user);

    expect(
      await screen.findByText(/Для подбора нужна цель/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Назначения у ребёнка нет/)).toBeNull();
  });

  it("подставляет цель приёма из назначения вместе с арифметикой", async () => {
    // 1200 ккал на 3 приёма — это 400, посчитанное из назначения, а не
    // константа, зашитая в экран и подписанная «задаётся вами». Совпадение
    // чисел здесь случайно: важно, что показана арифметика (ADR-0028,
    // вопрос 24 медкоманде).
    renderCalculator(PATIENT_ID);

    const kcal = await screen.findByLabelText(/Калорийность/);
    await waitFor(() => expect(kcal).toHaveValue(400));
    expect(
      screen.getByText("Из назначения: 1200 ккал ÷ 3 приёма"),
    ).toBeInTheDocument();
  });
});

describe("калькулятор без выбранного ребёнка", () => {
  it("считает и не требует выбирать пациента", async () => {
    // «Выйдет ли 4:1 на этих продуктах» — вопрос о продуктах. Пока он был
    // общим с вопросом «годится ли это ЭТОМУ ребёнку», специалист с когортой в
    // полсотни получал вместо калькулятора пятьдесят кнопок «выберите
    // ребёнка». Сервер расчёт без пациента разрешал всегда.
    const user = userEvent.setup();
    renderCalculator();

    await addButter(user);

    expect(await screen.findByText(/Кетосоотношение/)).toBeInTheDocument();
    expect(screen.queryByText("Выберите ребёнка")).not.toBeInTheDocument();
  });

  it("не выдумывает цель и не судит по ней", async () => {
    // Раньше экран подставлял 4:1 и 400 ккал, подписывал их как «задаётся
    // вами» и объявлял первый же добавленный продукт не попавшим в цель,
    // которую сам и придумал.
    const user = userEvent.setup();
    renderCalculator();

    await addButter(user);

    expect(await screen.findByLabelText(/Калорийность/)).toHaveValue(null);
    expect(
      screen.getByText(/Цель не задана: показатели считаются/),
    ).toBeInTheDocument();
    // Ни «достигнута», ни «не достигнута»: сравнивать не с чем, и молчание
    // здесь честнее догадки.
    await waitFor(
      () => expect(screen.getByText(/374 ккал/)).toBeInTheDocument(),
      { timeout: AUTO_CALC_TIMEOUT_MS },
    );
    expect(screen.queryByText("Цель достигнута")).not.toBeInTheDocument();
    expect(screen.queryByText("Цель не достигнута")).not.toBeInTheDocument();
  });

  it("масса тяжелее предела не передаётся пациенту, и причина названа", async () => {
    const user = userEvent.setup();
    renderCalculator();
    await addButter(user);

    const grams = screen.getByLabelText(/Масса продукта/);
    await user.clear(grams);
    await user.type(grams, "5001");

    const handOff = screen.getByRole("button", { name: "Передать" });
    expect(handOff).toBeDisabled();
    const reasons = screen
      .getAllByText("Масса продукта «Масло сливочное» больше 5000 г.")
      .map((element) => element.id);
    expect(reasons).toContain(handOff.getAttribute("aria-describedby"));
  });

  it("предлагает передать состав пациенту вместо «сохранить себе»", async () => {
    // Своё блюдо бывает только чьё-то: сохранять раскладку некуда, пока не
    // сказано, кому она нужна.
    const user = userEvent.setup();
    renderCalculator();

    await addButter(user);

    expect(
      await screen.findByRole("heading", { name: "Передать пациенту" }),
    ).toBeInTheDocument();
  });

  it("в карте ребёнка сохраняет сразу ему, ничего не спрашивая", async () => {
    const user = userEvent.setup();
    renderCalculator(PATIENT_ID);

    await addButter(user);

    expect(
      await screen.findByRole("heading", { name: /Сохранить/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Передать пациенту" }),
    ).not.toBeInTheDocument();
  });
});

describe("оболочка экрана", () => {
  it("в карте пациента не рисует второго заголовка", () => {
    // Заголовок там уже есть — название раздела карты. Свой `PageLayout`
    // внутри чужого дал бы `h1` внутри `h1`, и «Калькулятор» печатался бы
    // дважды подряд.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { container } = render(
      <QueryClientProvider client={client}>
        <SectionRouter section="calculator">
          <CalculatorView patientId={PATIENT_ID} />
        </SectionRouter>
      </QueryClientProvider>,
    );

    expect(container.querySelectorAll("h1")).toHaveLength(0);
  });
});
