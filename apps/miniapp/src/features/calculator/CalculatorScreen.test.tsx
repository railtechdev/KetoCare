import { NetworkError } from "@ketocare/api-client";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { CalculatorScreen } from "./CalculatorScreen";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

const WAITING = "Нет связи — посчитаем, когда она появится.";

const SESSION = {
  patientId: "11111111-1111-4111-8111-111111111111",
  patientName: "Амина",
};

const PRODUCT = {
  id: "p1",
  name_ru: "Масло сливочное",
  kcal_100g: 748,
  fat_100g: 82.5,
  protein_100g: 0.5,
  carbs_100g: 0.8,
  fiber_100g: 0,
  is_active: true,
};

const PRESCRIPTION = {
  ratio: 3.5,
  kcal_per_day: 1200,
  protein_g: 24,
  carbs_limit_g: 10,
  meals_per_day: 4,
};

/** Позиция состава со вкладом: так её отдаёт ядро с версии 0.4.0. */
function item(grams: number, kcal: number) {
  return {
    product_id: "p1",
    grams,
    kcal,
    fat_g: 24.8,
    protein_g: 0.2,
    carbs_g: 0.2,
    fiber_g: 0,
  };
}

function verifyResponse(overrides: Record<string, unknown> = {}) {
  return {
    dish: {
      items: [item(30, 224)],
      kcal: 224,
      fat_g: 24.8,
      protein_g: 0.2,
      carbs_g: 0.2,
      fiber_g: 0,
      net_carbs_g: 0.2,
      ratio: 3.9,
      engine_version: "1.0.0",
    },
    ratio_within_tolerance: true,
    kcal_within_tolerance: true,
    excluded: [],
    ...overrides,
  };
}

function solveResponse(overrides: Record<string, unknown> = {}) {
  return {
    dish: {
      items: [item(42.5, 300)],
      kcal: 300,
      fat_g: 31.2,
      protein_g: 4,
      carbs_g: 4,
      fiber_g: 0,
      net_carbs_g: 4,
      ratio: 3.5,
      engine_version: "1.0.0",
    },
    ratio_within_tolerance: true,
    kcal_within_tolerance: true,
    excluded: [],
    ...overrides,
  };
}

function scaleResponse(overrides: Record<string, unknown> = {}) {
  return {
    dish: {
      items: [item(15, 112)],
      kcal: 112,
      fat_g: 12.4,
      protein_g: 0.1,
      carbs_g: 0.1,
      fiber_g: 0,
      net_carbs_g: 0.1,
      ratio: 3.9,
      engine_version: "1.0.0",
    },
    ...overrides,
  };
}

/**
 * Ответы по путям: экран ходит в три разные ручки, и общая заглушка их путает.
 *
 * Проверка без целей отвечает пустыми вердиктами — так делает сервер, и
 * заглушка обязана повторять именно это: иначе тест «без цели вывода нет»
 * проходил бы на выдуманном ответе.
 */
function respond(byPath: Record<string, unknown> = {}) {
  (api.POST as Mock).mockImplementation(
    (path: string, options: { body?: { targets?: unknown } }) => {
      const found = Object.entries(byPath).find(([key]) => path.endsWith(key));
      if (found?.[1] instanceof Error) {
        return Promise.resolve({ error: (found[1] as ApiFailure).body });
      }
      if (found !== undefined) return Promise.resolve({ data: found[1] });

      const targeted =
        options.body?.targets !== null && options.body?.targets !== undefined;
      return Promise.resolve({
        data: verifyResponse(
          targeted
            ? {}
            : { ratio_within_tolerance: null, kcal_within_tolerance: null },
        ),
      });
    },
  );
}

/** Отказ сервера в формате раздела 5.1 ТЗ. */
class ApiFailure extends Error {
  constructor(readonly body: unknown) {
    super("api error");
  }
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
  // `client` — для тестов, которым нужен сам кэш запросов (отмена повтора).
  const result = render(<CalculatorScreen session={SESSION} />, {
    wrapper: Wrapper,
  });
  return Object.assign(result, { client });
}

/**
 * Проверка 30 г сначала отвечает, а её перезапросы — как скажет `refetch`.
 * Остальные массы отвечают всегда.
 */
function refetchOf30Fails(refetch: () => Promise<unknown>) {
  let calls30 = 0;
  (api.POST as Mock).mockImplementation(
    (path: string, options: { body?: { items?: { grams: number }[] } }) => {
      if (!path.endsWith("/calc/verify")) {
        return Promise.resolve({ data: solveResponse() });
      }
      if (options.body?.items?.[0]?.grams !== 30) {
        return Promise.resolve({ data: verifyResponse() });
      }
      calls30 += 1;
      return calls30 === 1
        ? Promise.resolve({ data: verifyResponse() })
        : refetch();
    },
  );
}

/** 30 г посчитано, 300 г посчитано, снова 30 г — расчёт из кэша перезапрашивается. */
async function returnToCachedGrams(user: ReturnType<typeof userEvent.setup>) {
  await addProduct(user);
  expect(await screen.findByText("Цель достигнута")).toBeInTheDocument();
  const grams = screen.getByLabelText(/Масло сливочное, граммы/);
  await user.type(grams, "0");
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Цель достигнута")).toBeInTheDocument();
  await user.type(grams, "{Backspace}");
}

async function addProduct(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Найдите продукт"), "масло");
  await user.click(
    await screen.findByRole("button", { name: "Масло сливочное" }),
  );
  await user.type(
    await screen.findByLabelText(/Масло сливочное, граммы/),
    "30",
  );
}

/** Сводка как обычно, а поиск продукта ничего не находит. */
function mockEmptySearch() {
  (api.GET as Mock).mockImplementation((path: string) =>
    path.includes("overview")
      ? Promise.resolve({
          data: {
            patient_id: SESSION.patientId,
            date: "2026-08-31",
            prescription: PRESCRIPTION,
            day: null,
            last_ketone: null,
            last_weight: null,
            seizures_today: { entries: 0, count: 0 },
          },
        })
      : Promise.resolve({ data: { items: [], total: 0 } }),
  );
}

function mockOverview(prescription: unknown = PRESCRIPTION) {
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path.includes("overview")) {
      return Promise.resolve({
        data: {
          patient_id: SESSION.patientId,
          date: "2026-08-31",
          prescription,
          day: null,
          last_ketone: null,
          last_weight: null,
          seizures_today: { entries: 0, count: 0 },
        },
      });
    }
    return Promise.resolve({ data: { items: [PRODUCT], total: 1 } });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOverview();
  respond();
});

describe("калькулятор в Mini App", () => {
  it("за набранное слово уходит один запрос, а не запрос на букву", async () => {
    // Без задержки каждая буква после второй уходила бы полнотекстовым
    // запросом к базе: «масло» — четыре запроса вместо одного.
    const user = userEvent.setup();
    renderScreen();

    await user.type(await screen.findByLabelText("Найдите продукт"), "масло");
    expect(
      await screen.findByRole("button", { name: "Масло сливочное" }),
    ).toBeInTheDocument();

    const searches = (api.GET as Mock).mock.calls.filter(([path]) =>
      String(path).includes("/products"),
    );
    expect(searches).toHaveLength(1);
  });

  it("в паузу перед запросом не говорит «ничего не нашлось»", async () => {
    // Проверяется второй поиск: при первом списка ещё нет вовсе. После него
    // прошлая выдача держится намеренно (`keepPreviousData`), и «ничего не
    // нашлось» в паузу — ответ о прежних буквах, а у плиты он читается как
    // приговор продукту.
    const user = userEvent.setup();
    mockEmptySearch();
    renderScreen();

    const field = await screen.findByLabelText("Найдите продукт");
    await user.type(field, "фуагра");
    expect(await screen.findByText("Ничего не нашлось")).toBeInTheDocument();

    await user.type(field, " по-русски");

    expect(screen.queryByText("Ничего не нашлось")).toBeNull();
  });

  it("без сети поиск говорит про связь, а не «ничего не нашлось»", async () => {
    // На паузе `isFetching` ложен, а прошлый пустой ответ `keepPreviousData`
    // отдаёт и запросу, который ещё не уходил: без проверки паузы экран снова
    // отвечал бы о прежних буквах, да ещё рядом со строкой про связь.
    const user = userEvent.setup();
    mockEmptySearch();
    renderScreen();

    const field = await screen.findByLabelText("Найдите продукт");
    await user.type(field, "фуагра");
    expect(await screen.findByText("Ничего не нашлось")).toBeInTheDocument();

    onlineManager.setOnline(false);
    try {
      await user.type(field, " по-русски");

      expect(
        await screen.findByText(
          "Нет связи — покажем, как только она появится.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText("Ничего не нашлось")).toBeNull();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("о связи говорит один голос: расчёт, а не ещё и поиск", async () => {
    // Две фразы об одной причине — тот же текст дважды (правило П27). Когда о
    // паузе говорит расчёт, поиск молчит.
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    onlineManager.setOnline(false);
    try {
      // На паузе обязаны оказаться оба запроса: правка граммовки ставит на
      // паузу проверку, набор в поиске — поиск. Иначе молчание поиска ничего
      // не доказывает: выключенный запрос молчит и без правила.
      await user.type(
        await screen.findByLabelText(/Масло сливочное, граммы/),
        "5",
      );
      await user.type(screen.getByLabelText("Найдите продукт"), "сыр");

      expect(await screen.findByText(WAITING)).toBeInTheDocument();
      expect(
        screen.queryByText("Нет связи — покажем, как только она появится."),
      ).toBeNull();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("живёт одним экраном: режимов-вкладок нет", async () => {
    // Вкладки разрезали одно непрерывное действие на три экрана, и решатель
    // граммовки лежал за второй из них (ADR-0028). Кабинет устроен так же.
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Подобрать граммовку" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Пересчитать порции" }),
    ).toBeInTheDocument();
  });

  it("подставляет цель приёма из назначения вместе с арифметикой", async () => {
    // Раньше калорийность приёма оставалась пустой, а подпись утверждала, что
    // делить суточную норму поровну нельзя, — при том что кабинет ровно так и
    // делает с 08.09.2026 (решение заказчика, вопрос 24 медкоманде открыт).
    const user = userEvent.setup();
    renderScreen();

    await waitFor(() =>
      expect(screen.getByLabelText("Кетосоотношение")).toHaveValue("3.5"),
    );
    expect(screen.getByLabelText("Ккал на приём")).toHaveValue("300");
    expect(
      screen.getByText("Из назначения: 1200 ккал ÷ 4 приёма"),
    ).toBeInTheDocument();

    await addProduct(user);
    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/calc/verify",
        expect.objectContaining({
          body: expect.objectContaining({
            patient_id: SESSION.patientId,
            targets: expect.objectContaining({ ratio: 3.5, kcal: 300 }),
          }),
        }),
      );
    });
  });

  it("без назначения цель не выдумывается, и вердикта нет", async () => {
    mockOverview(null);
    const user = userEvent.setup();
    renderScreen();

    await addProduct(user);

    expect(screen.getByLabelText("Кетосоотношение")).toHaveValue("");
    expect(screen.getByLabelText("Ккал на приём")).toHaveValue("");
    expect(await screen.findByText(/Цель не задана/)).toBeInTheDocument();
    expect(await screen.findByText(/224 ккал/)).toBeInTheDocument();
    expect(screen.queryByText("Цель достигнута")).not.toBeInTheDocument();
    expect(screen.queryByText("Цель не достигнута")).not.toBeInTheDocument();
  });

  it("показывает вклад каждой позиции числами сервера", async () => {
    // По итогу блюда видно только, что оно мимо цели; что именно менять —
    // видно по вкладу строки. Считать его в браузере нельзя: это был бы
    // второй источник клинических чисел рядом с ядром.
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    const contribution = await screen.findByRole("group", {
      name: /Вклад продукта «Масло сливочное»/,
    });
    expect(contribution).toHaveTextContent("224");
    expect(contribution).toHaveTextContent("24.8");
  });

  it("расхождение с целью — строка рядом с числами, а не тревога", async () => {
    // Пока блюдо собирают, оно почти всегда мимо цели, и плашка на каждом
    // продукте мешает его собирать.
    respond({
      "/calc/verify": verifyResponse({
        ratio_within_tolerance: false,
        kcal_within_tolerance: true,
      }),
    });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    expect(await screen.findByText("Цель не достигнута")).toBeInTheDocument();
    // 224 ккал против цели в 300 — разницу иначе считают в уме.
    expect(screen.getByText("−76 ккал до цели")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("снимает вердикт, пока пересчёт не догнал правку", async () => {
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    expect(await screen.findByText("Цель достигнута")).toBeInTheDocument();

    // «Цель достигнута», посчитанное при прежней граммовке, рядом с новым
    // числом — не устаревшая выдача, а неверное утверждение: по нему готовят
    // еду ребёнку. Само число остаётся.
    await user.type(screen.getByLabelText(/Масло сливочное, граммы/), "0");

    await waitFor(() =>
      expect(screen.queryByText("Цель достигнута")).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/224 ккал/)).toBeInTheDocument();
  });

  it("новый состав без сети говорит, что ждёт связи, и досчитывает с её возвратом", async () => {
    // Без сети запрос встаёт на паузу, а `isFetching` на паузе ложно: набранный
    // состав оставался без чисел, без «Пересчитываем…» и без объяснения.
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText("Найдите продукт"), "масло");
    await user.click(
      await screen.findByRole("button", { name: "Масло сливочное" }),
    );

    try {
      act(() => {
        onlineManager.setOnline(false);
      });
      await user.type(
        await screen.findByLabelText(/Масло сливочное, граммы/),
        "30",
      );

      expect(await screen.findByText(WAITING)).toBeInTheDocument();
      expect(screen.queryByText(/224 ккал/)).not.toBeInTheDocument();

      act(() => {
        onlineManager.setOnline(true);
      });
      expect(await screen.findByText(/224 ккал/)).toBeInTheDocument();
      expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("вердикт из кэша без сети не выдаётся за посчитанный по этому вводу", async () => {
    // Возврат к прежней граммовке берёт её расчёт из кэша и перезапрашивает
    // его, если он устарел (в бою — через 30 с, у тестового клиента — сразу).
    // Без сети перезапрос ждёт на паузе, и прежний вердикт стоял как свежий,
    // хотя сервер его не подтверждал.
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    expect(await screen.findByText("Цель достигнута")).toBeInTheDocument();
    const grams = screen.getByLabelText(/Масло сливочное, граммы/);
    await user.type(grams, "0");
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Цель достигнута")).toBeInTheDocument();

    try {
      act(() => {
        onlineManager.setOnline(false);
      });
      await user.type(grams, "{Backspace}");

      expect(await screen.findByText(WAITING)).toBeInTheDocument();
      expect(screen.queryByText("Цель достигнута")).not.toBeInTheDocument();
      expect(screen.getByText(/224 ккал/)).toBeInTheDocument();

      act(() => {
        onlineManager.setOnline(true);
      });
      expect(await screen.findByText("Цель достигнута")).toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("упавший перезапрос при прежних данных не оставляет вердикт рядом с отказом", async () => {
    // Связь пропала без события `offline`: запрос не встаёт на паузу, а
    // падает, и данные прежнего ответа остаются. «Цель достигнута» рядом с
    // «Не удалось посчитать» — противоречие.
    refetchOf30Fails(() =>
      Promise.resolve({
        error: {
          error: { code: "internal", message: "Внутренняя ошибка сервера." },
        },
      }),
    );
    const user = userEvent.setup();
    renderScreen();
    await returnToCachedGrams(user);

    expect(
      await screen.findByText("Внутренняя ошибка сервера."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Цель достигнута")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Соотношение /)).toHaveAttribute(
      "data-state",
      "neutral",
    );
    expect(screen.getByText(/224 ккал/)).toBeInTheDocument();
  });

  it("повтор при прежних данных говорит одним голосом", async () => {
    // Вердикт на время повтора писал «Пересчитываем…», а скрытая строка —
    // «Повторяем…»: два разных объявления одновременно.
    let refetches = 0;
    refetchOf30Fails(() => {
      refetches += 1;
      return refetches === 1
        ? Promise.resolve({
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
    renderScreen();
    await returnToCachedGrams(user);

    await user.click(await screen.findByRole("button", { name: "Повторить" }));

    expect(
      await screen.findByRole("button", { name: "Повторяем…" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Пересчитываем…")).not.toBeInTheDocument();
  });

  it("правка ввода во время повтора при прежних данных говорит «Пересчитываем…»", async () => {
    // Пока правка не догнала расчёт, отказ и кнопка скрыты. Вердикт молчал ради
    // «Повторяем…», и на экране оставались прежние числа без единого слова.
    let refetches = 0;
    refetchOf30Fails(() => {
      refetches += 1;
      return refetches === 1
        ? Promise.resolve({
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
    renderScreen();
    await returnToCachedGrams(user);
    await user.click(await screen.findByRole("button", { name: "Повторить" }));
    await screen.findByRole("button", { name: "Повторяем…" });
    await user.type(screen.getByLabelText(/Масло сливочное, граммы/), "5");

    // Окно проверки — до конца задержки: после неё у новой граммовки ещё нет
    // блюда, и строки «Пересчитываем…» нет вместе с ним. Первая проверка
    // называет причину, если машина не успела: запрос новой граммовки уже ушёл.
    expect(
      (api.POST as Mock).mock.calls.some(
        ([, options]) => options?.body?.items?.[0]?.grams === 305,
      ),
    ).toBe(false);
    expect(screen.getByText("Пересчитываем…")).toBeInTheDocument();
    // И кнопка, и скрытая строка: во время правки «Повторяем…» не звучит.
    expect(screen.queryByText("Повторяем…")).not.toBeInTheDocument();
  });

  it("называет причину отказа проверки текстом сервера, как кабинет", async () => {
    // Общая подсказка скрывала причину: после пересчёта порций в массы, которые
    // расчёт не принимает, семья не узнавала, что не так (ADR-0028: экраны
    // кабинета и Mini App ведут себя одинаково).
    respond({
      "/calc/verify": new ApiFailure({
        error: {
          code: "validation_error",
          message: "Проверьте правильность заполнения полей.",
        },
      }),
    });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    expect(
      await screen.findByText("Проверьте правильность заполнения полей."),
    ).toBeInTheDocument();

    // Отказ о прежнем составе не висит рядом с правкой, пока расчёт не догнал.
    await user.type(screen.getByLabelText(/Масло сливочное, граммы/), "0");
    expect(
      screen.queryByText("Проверьте правильность заполнения полей."),
    ).not.toBeInTheDocument();
  });

  it("сбой проверки можно повторить — без фиктивной правки состава", async () => {
    // Сбой привязан к запросу с 30 г, а не к номеру вызова: промежуточное
    // «3» при наборе иначе съело бы сбой, и повторять было бы нечего.
    let failed = false;
    (api.POST as Mock).mockImplementation(
      (path: string, options: { body?: { items?: { grams: number }[] } }) => {
        if (!path.endsWith("/calc/verify")) {
          return Promise.resolve({ data: solveResponse() });
        }
        if (options.body?.items?.[0]?.grams === 30 && !failed) {
          failed = true;
          return Promise.resolve({
            error: {
              error: {
                code: "internal",
                message: "Внутренняя ошибка сервера.",
              },
            },
          });
        }
        return Promise.resolve({ data: verifyResponse() });
      },
    );
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    await user.click(await screen.findByRole("button", { name: "Повторить" }));

    expect(await screen.findByText(/224 ккал/)).toBeInTheDocument();
    expect(
      screen.queryByText("Внутренняя ошибка сервера."),
    ).not.toBeInTheDocument();
  });

  it("на время повтора отказ и кнопка остаются, фокус не теряется", async () => {
    let calls30 = 0;
    (api.POST as Mock).mockImplementation(
      (path: string, options: { body?: { items?: { grams: number }[] } }) => {
        if (!path.endsWith("/calc/verify")) {
          return Promise.resolve({ data: solveResponse() });
        }
        if (options.body?.items?.[0]?.grams !== 30) {
          return Promise.resolve({ data: verifyResponse() });
        }
        calls30 += 1;
        return calls30 === 1
          ? Promise.resolve({
              error: {
                error: {
                  code: "internal",
                  message: "Внутренняя ошибка сервера.",
                },
              },
            })
          : new Promise(() => {});
      },
    );
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    await user.click(await screen.findByRole("button", { name: "Повторить" }));

    const busy = await screen.findByRole("button", { name: "Повторяем…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveFocus();
    expect(screen.getByText("Внутренняя ошибка сервера.")).toBeInTheDocument();
  });

  it("сетевой сбой — ответа нет вовсе — тоже можно повторить", async () => {
    let failed = false;
    (api.POST as Mock).mockImplementation(
      (path: string, options: { body?: { items?: { grams: number }[] } }) => {
        if (!path.endsWith("/calc/verify")) {
          return Promise.resolve({ data: solveResponse() });
        }
        if (options.body?.items?.[0]?.grams === 30 && !failed) {
          failed = true;
          return Promise.reject(new NetworkError());
        }
        return Promise.resolve({ data: verifyResponse() });
      },
    );
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    await user.click(await screen.findByRole("button", { name: "Повторить" }));

    expect(await screen.findByText(/224 ккал/)).toBeInTheDocument();
  });

  it("правка ввода во время повтора не оставляет «Повторяем…» и прежний отказ", async () => {
    let calls30 = 0;
    let calls300 = 0;
    (api.POST as Mock).mockImplementation(
      (path: string, options: { body?: { items?: { grams: number }[] } }) => {
        if (!path.endsWith("/calc/verify")) {
          return Promise.resolve({ data: solveResponse() });
        }
        const grams = options.body?.items?.[0]?.grams;
        if (grams === 300) {
          calls300 += 1;
          return new Promise(() => {});
        }
        if (grams !== 30) return Promise.resolve({ data: verifyResponse() });
        calls30 += 1;
        return calls30 === 1
          ? Promise.resolve({
              error: {
                error: {
                  code: "internal",
                  message: "Внутренняя ошибка сервера.",
                },
              },
            })
          : new Promise(() => {});
      },
    );
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    await user.click(await screen.findByRole("button", { name: "Повторить" }));
    await screen.findByRole("button", { name: "Повторяем…" });

    await user.type(screen.getByLabelText(/Масло сливочное, граммы/), "0");
    await waitFor(() => expect(calls300).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      screen.queryByRole("button", { name: "Повторяем…" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Внутренняя ошибка сервера."),
    ).not.toBeInTheDocument();
  });

  it("повторный отказ с тем же текстом объявляется заново", async () => {
    (api.POST as Mock).mockImplementation(
      (path: string, options: { body?: { items?: { grams: number }[] } }) => {
        if (!path.endsWith("/calc/verify")) {
          return Promise.resolve({ data: solveResponse() });
        }
        if (options.body?.items?.[0]?.grams === 30) {
          return Promise.resolve({
            error: {
              error: {
                code: "internal",
                message: "Внутренняя ошибка сервера.",
              },
            },
          });
        }
        return Promise.resolve({ data: verifyResponse() });
      },
    );
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    await user.click(await screen.findByRole("button", { name: "Повторить" }));

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((el) => el.textContent === "Внутренняя ошибка сервера."),
      ).toBe(true),
    );
  });

  it("фоновый перезапрос после успешного повтора не возвращает прежний отказ", async () => {
    // Возврат сети перезапрашивает устаревшую проверку по тому же вводу, и
    // над числами успешного расчёта снова вставал и зачитывался старый отказ.
    let calls30 = 0;
    (api.POST as Mock).mockImplementation(
      (path: string, options: { body?: { items?: { grams: number }[] } }) => {
        if (!path.endsWith("/calc/verify")) {
          return Promise.resolve({ data: solveResponse() });
        }
        if (options.body?.items?.[0]?.grams !== 30) {
          return Promise.resolve({ data: verifyResponse() });
        }
        calls30 += 1;
        if (calls30 === 1) {
          return Promise.resolve({
            error: {
              error: {
                code: "internal",
                message: "Внутренняя ошибка сервера.",
              },
            },
          });
        }
        return calls30 === 2
          ? Promise.resolve({ data: verifyResponse() })
          : new Promise(() => {});
      },
    );
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    await user.click(await screen.findByRole("button", { name: "Повторить" }));
    expect(await screen.findByText(/224 ккал/)).toBeInTheDocument();

    try {
      act(() => {
        onlineManager.setOnline(false);
      });
      act(() => {
        onlineManager.setOnline(true);
      });
      await waitFor(() => expect(calls30).toBe(3));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(
        screen.queryByText("Внутренняя ошибка сервера."),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Повторяем…" }),
      ).not.toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("повторный отказ с другим текстом объявляет только сам отказ", async () => {
    let calls30 = 0;
    (api.POST as Mock).mockImplementation(
      (path: string, options: { body?: { items?: { grams: number }[] } }) => {
        if (!path.endsWith("/calc/verify")) {
          return Promise.resolve({ data: solveResponse() });
        }
        if (options.body?.items?.[0]?.grams !== 30) {
          return Promise.resolve({ data: verifyResponse() });
        }
        calls30 += 1;
        return calls30 === 1
          ? Promise.reject(new NetworkError())
          : Promise.resolve({
              error: {
                error: {
                  code: "internal",
                  message: "Внутренняя ошибка сервера.",
                },
              },
            });
      },
    );
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    await user.click(await screen.findByRole("button", { name: "Повторить" }));
    await screen.findByText("Внутренняя ошибка сервера.");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      screen
        .getAllByRole("status")
        .some((el) => el.textContent === "Внутренняя ошибка сервера."),
    ).toBe(false);
  });

  it("«Повторить» без сети не прячет отказ, кнопку и фокус", async () => {
    // Без сети запрос встаёт на паузу, а `isFetching` на паузе ложно: нажатая
    // кнопка пропадала вместе с фокусом и текстом отказа до возврата сети.
    let calls30 = 0;
    (api.POST as Mock).mockImplementation(
      (path: string, options: { body?: { items?: { grams: number }[] } }) => {
        if (!path.endsWith("/calc/verify")) {
          return Promise.resolve({ data: solveResponse() });
        }
        if (options.body?.items?.[0]?.grams !== 30) {
          return Promise.resolve({ data: verifyResponse() });
        }
        calls30 += 1;
        return calls30 === 1
          ? Promise.resolve({
              error: {
                error: {
                  code: "internal",
                  message: "Внутренняя ошибка сервера.",
                },
              },
            })
          : Promise.resolve({ data: verifyResponse() });
      },
    );
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    const retry = await screen.findByRole("button", { name: "Повторить" });

    try {
      act(() => {
        onlineManager.setOnline(false);
      });
      await user.click(retry);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const busy = screen.getByRole("button", { name: "Повторяем…" });
      expect(busy).toHaveFocus();
      // Об отказе и повторе уже сказано — «ждём связи» третьим голосом лишнее.
      expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
      expect(
        screen.getByText("Внутренняя ошибка сервера."),
      ).toBeInTheDocument();

      act(() => {
        onlineManager.setOnline(true);
      });
      expect(await screen.findByText(/224 ккал/)).toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("отменённый повтор не зачитывает прежний отказ как свой ответ", async () => {
    // Отмена запроса с откатом возвращает его в прежнюю ошибку и покой. Без
    // сверки счётчика ошибок скрытая строка объявила бы старый отказ ответом
    // повтора. С экрана сегодня до такой отмены не дойти — тест держит
    // страховку от будущего `cancelQueries` или переноса `refetch`.
    (api.POST as Mock).mockImplementation(
      (path: string, options: { body?: { items?: { grams: number }[] } }) => {
        if (!path.endsWith("/calc/verify")) {
          return Promise.resolve({ data: solveResponse() });
        }
        if (options.body?.items?.[0]?.grams !== 30) {
          return Promise.resolve({ data: verifyResponse() });
        }
        return Promise.resolve({
          error: {
            error: { code: "internal", message: "Внутренняя ошибка сервера." },
          },
        });
      },
    );
    const user = userEvent.setup();
    const { client } = renderScreen();
    await addProduct(user);
    const retry = await screen.findByRole("button", { name: "Повторить" });
    const status = screen
      .getAllByRole("status")
      .find((el) => el.classList.contains("sr-only")) as HTMLElement;

    try {
      act(() => {
        onlineManager.setOnline(false);
      });
      await user.click(retry);
      await act(() => client.cancelQueries({ queryKey: ["calc", "verify"] }));
      // Уведомление о смене состояния приходит таймером: ждём, пока повтор
      // перестанет считаться идущим, — и только тогда смотрим, что объявлено.
      await waitFor(() => expect(status.textContent).not.toBe("Повторяем…"));

      expect(status.textContent).toBe("");
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("отказ проверки по данным повторить не предлагает", async () => {
    respond({
      "/calc/verify": new ApiFailure({
        error: {
          code: "validation_error",
          message: "Проверьте правильность заполнения полей.",
        },
      }),
    });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    await screen.findByText("Проверьте правильность заполнения полей.");
    expect(
      screen.queryByRole("button", { name: "Повторить" }),
    ).not.toBeInTheDocument();
  });

  it("отказ проверки не мигает при возврате в приложение", async () => {
    // Запрос с ошибкой всегда считается устаревшим, и перезапрос по фокусу
    // снимал баннер на время запроса — кабинет так себя не ведёт.
    const message = "Проверьте правильность заполнения полей.";
    respond({
      "/calc/verify": new ApiFailure({
        error: { code: "validation_error", message },
      }),
    });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    expect(await screen.findByText(message)).toBeInTheDocument();
    const calls = (api.POST as Mock).mock.calls.length;

    // Повторная проверка, если бы она случилась, повисла бы: пока она идёт,
    // баннер скрыт, и мерцание было бы видно не только по числу запросов.
    (api.POST as Mock).mockImplementation(() => new Promise(() => {}));
    try {
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect((api.POST as Mock).mock.calls.length).toBe(calls);
      expect(screen.getByText(message)).toBeInTheDocument();
    } finally {
      // Фокус глобален: упавший тест не должен оставлять его принудительным.
      focusManager.setFocused(undefined);
    }
  });

  it("один и тот же отказ не показывается двумя баннерами", async () => {
    // Больше 5000 г руками: проверка и пересчёт отказывают одним текстом, и два
    // одинаковых красных баннера нарушали правило П27.
    const message = "Проверьте правильность заполнения полей.";
    const refusal = { error: { code: "validation_error", message } };
    respond({
      "/calc/verify": new ApiFailure(refusal),
      "/calc/scale": new ApiFailure(refusal),
    });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    expect(await screen.findByText(message)).toBeInTheDocument();

    const factor = screen.getByLabelText("Умножить на");
    await user.clear(factor);
    await user.type(factor, "2");
    await user.click(
      screen.getByRole("button", { name: "Пересчитать порции" }),
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
    respond({
      "/calc/verify": new ApiFailure({
        error: {
          code: "validation_error",
          message: "Проверьте правильность заполнения полей.",
        },
      }),
      "/calc/scale": new ApiFailure({
        error: { code: "internal", message: "Сервер недоступен." },
      }),
    });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    expect(
      await screen.findByText("Проверьте правильность заполнения полей."),
    ).toBeInTheDocument();

    const factor = screen.getByLabelText("Умножить на");
    await user.clear(factor);
    await user.type(factor, "2");
    await user.click(
      screen.getByRole("button", { name: "Пересчитать порции" }),
    );

    expect(await screen.findByText("Сервер недоступен.")).toBeInTheDocument();
  });

  it("запятая в граммовке считается, а не глушит расчёт", async () => {
    // Русская клавиатура телефона в числовом режиме даёт запятую: «12,5»
    // превращалось в не-число, и расчёт молча не запускался (находка М5).
    const user = userEvent.setup();
    renderScreen();

    await user.type(screen.getByLabelText("Найдите продукт"), "масло");
    await user.click(
      await screen.findByRole("button", { name: "Масло сливочное" }),
    );
    await user.type(
      await screen.findByLabelText(/Масло сливочное, граммы/),
      "12,5",
    );

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/calc/verify",
        expect.objectContaining({
          body: expect.objectContaining({
            items: [expect.objectContaining({ grams: 12.5 })],
          }),
        }),
      );
    });
    // Ввод остаётся на экране как набран: поле не «съедает» запятую.
    expect(screen.getByLabelText(/Масло сливочное, граммы/)).toHaveValue(
      "12,5",
    );
  });

  it("запятая в цели считается так же, как в граммовке", async () => {
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    const ratio = screen.getByLabelText("Кетосоотношение");
    await user.clear(ratio);
    await user.type(ratio, "2,5");

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/calc/verify",
        expect.objectContaining({
          body: expect.objectContaining({
            targets: expect.objectContaining({ ratio: 2.5 }),
          }),
        }),
      );
    });
  });

  it("блюдо без белка и углеводов не выдаётся за «0.0 : 1»", async () => {
    // Соотношение приходит пустым, когда делить не на что — например, в блюде
    // из одного масла. «0.0 : 1» означало бы блюдо без жира, то есть ровно
    // противоположное тому, что на весах. Замечено на живом экране.
    respond({
      "/calc/verify": verifyResponse({
        dish: { ...verifyResponse().dish, ratio: null },
        ratio_within_tolerance: null,
        kcal_within_tolerance: null,
      }),
    });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    expect(
      await screen.findByLabelText("Соотношение не определено"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0\.0/)).not.toBeInTheDocument();
  });

  it("исключённый ребёнку продукт назван прямо в расчёте", async () => {
    respond({
      "/calc/verify": verifyResponse({
        excluded: [{ product_id: "p1", name_ru: "Арахис" }],
      }),
    });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    // Имя стоит во фразе, которая говорит и что делать: «Расчёт сделан как
    // есть — состав задали вы. Уберите продукт или согласуйте его с врачом».
    expect(await screen.findByText(/^Арахис\./)).toBeInTheDocument();
  });

  it("исключённый продукт без имени назван словами, а не идентификатором", async () => {
    // Продукт могли удалить из справочника; 36 знаков UUID семье не говорят
    // ничего (находка М6, тот же класс, что Н1 кабинета).
    respond({
      "/calc/verify": verifyResponse({
        excluded: [{ product_id: "0f9b7c33-1111-4111-8111-222222222222" }],
      }),
    });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    expect(
      await screen.findByText(/продукт удалён из справочника/),
    ).toBeInTheDocument();
    // И сказано, что с этим делать, а не только что случилось.
    expect(screen.getByText(/согласуйте его с врачом/)).toBeInTheDocument();
    expect(screen.queryByText(/0f9b7c33/)).not.toBeInTheDocument();
  });

  it("подобранные массы попадают в состав, а не остаются в ответе", async () => {
    // Иначе цепочка «подобрал → округлил под кухонные весы → проверил»
    // рвётся на первом шаге: из подбора ведёт один выход — принять как есть.
    respond({ "/calc/solve": solveResponse() });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    await user.click(
      screen.getByRole("button", { name: "Подобрать граммовку" }),
    );

    expect(await screen.findByLabelText(/Масло сливочное, граммы/)).toHaveValue(
      "42.5",
    );
  });

  it("подбор без сети называет причину и доходит с возвратом связи", async () => {
    // Мутация без сети встаёт на паузу: кнопка стояла на «Считаем…» серой, и
    // ни слова о том, почему.
    respond({ "/calc/solve": solveResponse() });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    expect(await screen.findByText("Цель достигнута")).toBeInTheDocument();

    try {
      act(() => {
        onlineManager.setOnline(false);
      });
      await user.click(
        screen.getByRole("button", { name: "Подобрать граммовку" }),
      );

      const busy = await screen.findByRole("button", { name: "Считаем…" });
      expect(busy).toHaveAccessibleDescription(WAITING);

      act(() => {
        onlineManager.setOnline(true);
      });
      // Мутация продолжается сама после события `online` — асинхронно.
      await waitFor(() =>
        expect(screen.getByLabelText(/Масло сливочное, граммы/)).toHaveValue(
          "42.5",
        ),
      );
      expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("о связи говорит одна строка, когда ждут и проверка, и подбор", async () => {
    respond({ "/calc/solve": solveResponse() });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    expect(await screen.findByText("Цель достигнута")).toBeInTheDocument();

    try {
      act(() => {
        onlineManager.setOnline(false);
      });
      await user.type(screen.getByLabelText(/Масло сливочное, граммы/), "0");
      expect(await screen.findByText(WAITING)).toBeInTheDocument();
      await user.click(
        screen.getByRole("button", { name: "Подобрать граммовку" }),
      );

      const busy = await screen.findByRole("button", { name: "Считаем…" });
      expect(screen.getAllByText(WAITING)).toHaveLength(1);
      // Строка одна, но занятая кнопка описана ею — иначе программа чтения
      // услышала бы «Считаем…» без причины.
      expect(busy).toHaveAccessibleDescription(WAITING);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("подбор на прежних числах без сети описан строкой ожидания над ними", async () => {
    // Возврат к прежней граммовке: числа из кэша на месте, перезапрос ждёт
    // связи, и «Нет связи» стоит в строке вердикта — подбор описан ею.
    respond({ "/calc/solve": solveResponse() });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    expect(await screen.findByText("Цель достигнута")).toBeInTheDocument();
    const grams = screen.getByLabelText(/Масло сливочное, граммы/);
    await user.type(grams, "0");
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Цель достигнута")).toBeInTheDocument();

    try {
      act(() => {
        onlineManager.setOnline(false);
      });
      await user.type(grams, "{Backspace}");
      expect(await screen.findByText(WAITING)).toBeInTheDocument();
      expect(screen.getByText(/224 ккал/)).toBeInTheDocument();
      await user.click(
        screen.getByRole("button", { name: "Подобрать граммовку" }),
      );

      const busy = await screen.findByRole("button", { name: "Считаем…" });
      expect(screen.getAllByText(WAITING)).toHaveLength(1);
      expect(busy).toHaveAccessibleDescription(WAITING);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("пересчёт порций без сети тоже называет причину и доходит с возвратом связи", async () => {
    respond({ "/calc/scale": scaleResponse() });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    expect(await screen.findByText("Цель достигнута")).toBeInTheDocument();

    try {
      act(() => {
        onlineManager.setOnline(false);
      });
      const factor = screen.getByLabelText("Умножить на");
      await user.clear(factor);
      await user.type(factor, "2");
      await user.click(
        screen.getByRole("button", { name: "Пересчитать порции" }),
      );

      const busy = await screen.findByRole("button", { name: "Считаем…" });
      expect(busy).toHaveAccessibleDescription(WAITING);

      act(() => {
        onlineManager.setOnline(true);
      });
      await waitFor(() =>
        expect(screen.getByLabelText(/Масло сливочное, граммы/)).toHaveValue(
          "15",
        ),
      );
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("правка предела на паузе не даёт подбору переписать граммовку", async () => {
    // Раскладка по прежнему пределу углеводов легла бы в состав после
    // возврата связи, и вердикт этого не заметил бы: пределов он не судит.
    respond({ "/calc/solve": solveResponse() });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    expect(await screen.findByText("Цель достигнута")).toBeInTheDocument();

    try {
      act(() => {
        onlineManager.setOnline(false);
      });
      await user.click(
        screen.getByRole("button", { name: "Подобрать граммовку" }),
      );
      await screen.findByRole("button", { name: "Считаем…" });
      await user.type(screen.getByLabelText("Углеводы не больше, г"), "5");

      act(() => {
        onlineManager.setOnline(true);
      });
      await waitFor(() =>
        expect(
          (api.POST as Mock).mock.calls.some(([path]) =>
            String(path).endsWith("/calc/solve"),
          ),
        ).toBe(true),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.getByLabelText(/Масло сливочное, граммы/)).toHaveValue(
        "30",
      );
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("правка состава на паузе не даёт подбору переписать граммовку", async () => {
    respond({ "/calc/solve": solveResponse() });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    expect(await screen.findByText("Цель достигнута")).toBeInTheDocument();

    try {
      act(() => {
        onlineManager.setOnline(false);
      });
      await user.click(
        screen.getByRole("button", { name: "Подобрать граммовку" }),
      );
      await screen.findByRole("button", { name: "Считаем…" });
      await user.type(screen.getByLabelText(/Масло сливочное, граммы/), "0");

      act(() => {
        onlineManager.setOnline(true);
      });
      await waitFor(() =>
        expect(
          (api.POST as Mock).mock.calls.some(([path]) =>
            String(path).endsWith("/calc/solve"),
          ),
        ).toBe(true),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.getByLabelText(/Масло сливочное, граммы/)).toHaveValue(
        "300",
      );
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("подбор на повторе без сети называет причину строкой действий", async () => {
    // Проверка упала, повтор ждёт связи: строки ожидания проверки нет — о
    // повторе говорят отказ и «Повторяем…», и подбору некем описаться, кроме
    // своей строки.
    (api.POST as Mock).mockImplementation(
      (path: string, options: { body?: { items?: { grams: number }[] } }) => {
        if (path.endsWith("/calc/solve")) {
          return Promise.resolve({ data: solveResponse() });
        }
        if (options.body?.items?.[0]?.grams !== 30) {
          return Promise.resolve({ data: verifyResponse() });
        }
        return Promise.resolve({
          error: {
            error: { code: "internal", message: "Внутренняя ошибка сервера." },
          },
        });
      },
    );
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    const retry = await screen.findByRole("button", { name: "Повторить" });

    try {
      act(() => {
        onlineManager.setOnline(false);
      });
      await user.click(retry);
      await screen.findByRole("button", { name: "Повторяем…" });
      await user.click(
        screen.getByRole("button", { name: "Подобрать граммовку" }),
      );

      const busy = await screen.findByRole("button", { name: "Считаем…" });
      expect(busy).toHaveAccessibleDescription(WAITING);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("подбор уходит с целями назначения и пределами", async () => {
    respond({ "/calc/solve": solveResponse() });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    await user.type(screen.getByLabelText("Белок не меньше, г"), "6");
    await user.type(screen.getByLabelText("Углеводы не больше, г"), "4");
    await user.click(
      screen.getByRole("button", { name: "Подобрать граммовку" }),
    );

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/calc/solve",
        expect.objectContaining({
          body: expect.objectContaining({
            patient_id: SESSION.patientId,
            targets: expect.objectContaining({
              ratio: 3.5,
              kcal: 300,
              protein_min_g: 6,
              // Лимит углеводов — по общим; соотношение сервер считает по
              // чистым. Переключателя `net_carbs` больше нет: клиника назвала
              // правило, а не выбор (ответы 2, 3 и 6).
              carbs_max_g: 4,
            }),
          }),
        }),
      );
    });
  });

  it("пределы подбора не гоняют проверку на сервер", async () => {
    // Проверке они ничего не меняют: состав задан целиком. В ключе запроса они
    // отправляли бы её в ядро на каждое нажатие в этих полях.
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    await screen.findByText(/224 ккал/);

    const before = (api.POST as Mock).mock.calls.length;
    await user.type(screen.getByLabelText("Белок не меньше, г"), "6");
    await waitFor(() =>
      expect(screen.getByLabelText("Белок не меньше, г")).toHaveValue("6"),
    );

    expect((api.POST as Mock).mock.calls.length).toBe(before);
  });

  it("отключённая кнопка называет причину", async () => {
    // Серая кнопка без объяснения — тупик: в кабинете на этом застряла
    // заказчица. Строка одна на блок действий: при пустом составе причина у
    // обеих кнопок одна и та же.
    renderScreen();

    const solve = await screen.findByRole("button", {
      name: "Подобрать граммовку",
    });
    const scale = screen.getByRole("button", { name: "Пересчитать порции" });
    const reason = screen.getByText("В составе нет продуктов.");

    expect(solve).toBeDisabled();
    expect(solve).toHaveAttribute("aria-describedby", reason.id);
    expect(scale).toHaveAttribute("aria-describedby", reason.id);
  });

  it("без цели подбор не запускается", async () => {
    // Подбирать не из чего: цель — это то, подо что решатель считает.
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    await user.clear(screen.getByLabelText("Ккал на приём"));

    expect(
      screen.getByRole("button", { name: "Подобрать граммовку" }),
    ).toBeDisabled();
    expect(
      await screen.findByText(/Для подбора нужна цель/),
    ).toBeInTheDocument();
  });

  it("масса тяжелее предела названа у поля и у кнопки и в расчёт не уходит", async () => {
    // Сервер не принимает позицию тяжелее 5000 г. До этой проверки показатели
    // пропадали, а на их месте стоял общий отказ — без слова о поле и пределе.
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    expect(await screen.findByText(/224 ккал/)).toBeInTheDocument();

    const grams = screen.getByLabelText(/Масло сливочное, граммы/);
    await user.clear(grams);
    // С запятой: предел сравнивается с тем же числом, что уходит в расчёт.
    await user.type(grams, "5000,5");

    const fieldError = screen.getByText(/Не больше 5000 г/);
    expect(grams).toHaveAttribute("aria-invalid", "true");
    expect(grams).toHaveAttribute("aria-describedby", fieldError.id);

    const scale = screen.getByRole("button", { name: "Пересчитать порции" });
    expect(scale).toBeDisabled();
    const reason = screen.getByText(
      "Масса продукта «Масло сливочное» больше 5000 г.",
    );
    expect(scale).toHaveAttribute("aria-describedby", reason.id);
    // Подбор граммов со входа не берёт — предел его не выключает.
    expect(
      screen.getByRole("button", { name: "Подобрать граммовку" }),
    ).toBeEnabled();

    // Числа прежней массы уходят — они о другом блюде, — а тяжёлая масса на
    // сервер не отправляется вовсе.
    await waitFor(() =>
      expect(screen.queryByText(/224 ккал/)).not.toBeInTheDocument(),
    );
    const sent = (api.POST as Mock).mock.calls
      .filter(([path]) => path === "/api/v1/calc/verify")
      .map(([, options]) => options.body.items[0].grams);
    expect(sent).not.toContain(5000.5);
  });

  it("пересчёт порций тоже переписывает состав, запятую понимает", async () => {
    // Пока пересчёт показывал массы отдельным списком, а старые оставлял в
    // полях, из результата вёл один выход — принять как есть.
    respond({ "/calc/scale": scaleResponse() });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    const factor = screen.getByLabelText("Умножить на");
    await user.clear(factor);
    await user.type(factor, "0,5");
    await user.click(
      screen.getByRole("button", { name: "Пересчитать порции" }),
    );

    await waitFor(() => {
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/calc/scale",
        expect.objectContaining({
          body: expect.objectContaining({
            factor: 0.5,
            items: [expect.objectContaining({ grams: 30 })],
          }),
        }),
      );
    });
    // Масса кладётся как её вернул сервер: своё округление на телефоне —
    // уже другая граммовка, чем в кабинете.
    expect(await screen.findByLabelText(/Масло сливочное, граммы/)).toHaveValue(
      "15",
    );
  });

  it("неразрешимая задача объясняется причиной, а не «ошибкой»", async () => {
    // Раздел 8.3 ТЗ: infeasible показывается человекочитаемой причиной.
    respond({
      "/calc/solve": new ApiFailure({
        error: {
          code: "infeasible_calculation",
          message: "Жиров набора не хватает на соотношение 3.5:1.",
        },
      }),
    });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    await user.click(
      screen.getByRole("button", { name: "Подобрать граммовку" }),
    );

    expect(
      await screen.findByText(/Жиров набора не хватает/),
    ).toBeInTheDocument();
  });

  it("снятые со входа продукты названы: решатель работал не со всем набором", async () => {
    // Подбор не предупреждает об исключённом, а вычёркивает его: сказать об
    // этом больше негде, своего блока у результата подбора нет.
    respond({
      "/calc/solve": solveResponse({
        excluded: [{ product_id: "p1", name_ru: "Арахис" }],
      }),
    });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);

    await user.click(
      screen.getByRole("button", { name: "Подобрать граммовку" }),
    );

    expect(
      await screen.findByText(/Не участвовало в подборе: Арахис/),
    ).toBeInTheDocument();
  });

  it("правка состава снимает прежний отказ подбора", async () => {
    // Причина, названная для прежнего набора продуктов, рядом с новым
    // составом — утверждение о блюде, которого на экране уже нет.
    respond({
      "/calc/solve": new ApiFailure({
        error: {
          code: "infeasible_calculation",
          message: "Жиров набора не хватает на соотношение 3.5:1.",
        },
      }),
    });
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    await user.click(
      screen.getByRole("button", { name: "Подобрать граммовку" }),
    );
    expect(
      await screen.findByText(/Жиров набора не хватает/),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Масло сливочное, граммы/), "1");

    await waitFor(() =>
      expect(
        screen.queryByText(/Жиров набора не хватает/),
      ).not.toBeInTheDocument(),
    );
  });

  it("убранный из состава продукт не оставляет своих чисел на экране", async () => {
    // Показатели пустого состава — утверждение о блюде, которого на экране уже
    // нет. В кабинете этот дефект был настоящим (результат мутации живёт, пока
    // его не сбросят); здесь ключ запроса меняется вместе с составом, и тест
    // держит это свойство.
    const user = userEvent.setup();
    renderScreen();
    await addProduct(user);
    expect(await screen.findByText(/224 ккал/)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Убрать Масло сливочное/ }),
    );

    await waitFor(() =>
      expect(screen.queryByText(/224 ккал/)).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Добавьте продукты/)).toBeInTheDocument();
  });

  it("пустой состав не уходит в расчёт", async () => {
    // Считать нечего, а запрос на каждый чих нагружает решатель.
    renderScreen();

    await screen.findByText(/Добавьте продукты/);
    expect(api.POST).not.toHaveBeenCalled();
  });
});
