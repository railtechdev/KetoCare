import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
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

    const grams = screen.getByLabelText(/Масса продукта/);
    await user.clear(grams);
    await user.type(grams, "5001");

    const fieldError = screen.getByText(/Не больше 5000 г/);
    expect(grams).toHaveAttribute("aria-invalid", "true");
    expect(grams).toHaveAttribute("aria-describedby", fieldError.id);

    const scale = screen.getByRole("button", { name: /Пересчитать порции/ });
    expect(scale).toBeDisabled();
    const reason = screen.getByText(
      "Масса продукта «Масло сливочное» больше 5000 г.",
    );
    expect(scale).toHaveAttribute("aria-describedby", reason.id);
    // Подбор граммов не берёт, он их пишет: предел ему не мешает.
    expect(
      screen.getByRole("button", { name: /Подобрать граммовку/ }),
    ).toBeEnabled();
    expect(
      screen.queryByText("Сохранить как моё блюдо"),
    ).not.toBeInTheDocument();

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
