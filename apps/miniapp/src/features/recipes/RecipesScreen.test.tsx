import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { RecipesScreen } from "./RecipesScreen";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

const showBackButton = vi.hoisted(() =>
  vi.fn<(onBack: () => void) => () => void>(() => () => undefined),
);
vi.mock("../../lib/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/telegram")>();
  return { ...actual, showBackButton };
});

const RECIPE = {
  id: "r1",
  title: "Омлет на сливках",
  category: "breakfast",
  photo_path: null,
  yield_g: 180,
  servings: 2,
  instructions: "Взбить.\nЖарить.",
  status: "published",
  computed: { kcal: 800, fat: 80, protein: 16, carbs: 4, fiber: 0, ratio: 4 },
  per_portion: { kcal: 400, fat: 40, protein: 8, carbs: 2, fiber: 0, ratio: 4 },
  engine_version: "1.0.0",
  author_id: "a1",
  ingredients: [],
  created_at: "2026-08-01T10:00:00Z",
};

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  // `client` — тестам, которым нужно очистить кэш до возврата сети (#174).
  const result = render(<RecipesScreen />, { wrapper: Wrapper });
  return Object.assign(result, { client });
}

beforeEach(() => {
  vi.clearAllMocks();
  // `response` в подмене обязателен: настоящий клиент отдаёт его всегда, а код
  // различает по нему 404 («такого продукта нет») и сбой связи.
  (api.GET as Mock).mockImplementation((path: string, options?: unknown) => {
    if (path.endsWith("{recipe_id}"))
      return Promise.resolve({ data: RECIPE, response: { status: 200 } });
    if (path.endsWith("{product_id}")) {
      const id = (options as { params: { path: { product_id: string } } })
        .params.path.product_id;
      return Promise.resolve({
        data: { id, name_ru: PRODUCT_NAMES[id] ?? "Продукт", is_active: true },
        response: { status: 200 },
      });
    }
    return Promise.resolve({
      data: { items: [RECIPE], total: 1 },
      response: { status: 200 },
    });
  });
});

const PRODUCT_NAMES: Record<string, string> = {
  "prod-1": "Яйцо куриное",
  "prod-2": "Сливки 33%",
};

describe("рецепты в Mini App", () => {
  it("первый поиск без сети говорит о связи один раз", async () => {
    // На первом поиске о паузе говорит ветка ожидания кита, на следующих —
    // своя строка. Если условия разойдутся, обе скажут одно и то же подряд
    // (правило П27).
    onlineManager.setOnline(false);
    const { client } = renderScreen();

    try {
      expect(
        await screen.findAllByText(
          "Нет связи — покажем, как только она появится.",
        ),
      ).toHaveLength(1);
    } finally {
      client.clear();
      onlineManager.setOnline(true);
    }
  });

  it("первая карточка без сети говорит о связи один раз", async () => {
    // На первом открытии о паузе говорит ветка ожидания кита, со второго —
    // своя строка. Разойдутся условия — обе скажут одно и то же подряд (П27).
    const user = userEvent.setup();
    const { client } = renderScreen();
    await screen.findByRole("button", { name: /Омлет/ });

    onlineManager.setOnline(false);
    try {
      await user.click(screen.getByRole("button", { name: /Омлет/ }));

      expect(
        await screen.findAllByText(
          "Нет связи — покажем, как только она появится.",
        ),
      ).toHaveLength(1);
    } finally {
      client.clear();
      onlineManager.setOnline(true);
    }
  });

  it("имена в составе живут построчно, а не одним ответом на всех", async () => {
    // Ради этого случая признак и сделан построчным: общий флаг переносил бы
    // ответ одной строки на другую.
    (api.GET as Mock).mockImplementation((path: string, options?: unknown) => {
      if (path.endsWith("{recipe_id}"))
        return Promise.resolve({
          data: {
            ...RECIPE,
            ingredients: [
              { product_id: "prod-1", grams: 120, position: 0 },
              { product_id: "prod-2", grams: 60, position: 1 },
            ],
          },
          response: { status: 200 },
        });
      if (path.endsWith("{product_id}")) {
        const id = (options as { params: { path: { product_id: string } } })
          .params.path.product_id;
        return id === "prod-1"
          ? Promise.resolve({
              data: { id, name_ru: PRODUCT_NAMES[id], is_active: true },
              response: { status: 200 },
            })
          : Promise.resolve({
              error: {
                error: { code: "not_found", message: "Продукт не найден." },
              },
              response: { status: 404 },
            });
      }
      return Promise.resolve({
        data: { items: [RECIPE], total: 1 },
        response: { status: 200 },
      });
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: /Омлет/ }));

    expect(await screen.findByText("Яйцо куриное")).toBeInTheDocument();
    expect(
      screen.getByText("продукт удалён из справочника"),
    ).toBeInTheDocument();
    expect(screen.getByText("120 г")).toBeInTheDocument();
    expect(screen.getByText("60 г")).toBeInTheDocument();
  });

  it("удалённый продукт так и называется — удалённым", async () => {
    // 404 — это ответ справочника «такого продукта нет». Назвать его сетевой
    // заминкой значит обещать, что имя вот-вот появится.
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path.endsWith("{recipe_id}"))
        return Promise.resolve({
          response: { status: 200 },
          data: {
            ...RECIPE,
            ingredients: [{ product_id: "prod-1", grams: 120, position: 0 }],
          },
        });
      if (path.endsWith("{product_id}"))
        return Promise.resolve({
          error: {
            error: { code: "not_found", message: "Продукт не найден." },
          },
          response: { status: 404 },
        });
      return Promise.resolve({
        data: { items: [RECIPE], total: 1 },
        response: { status: 200 },
      });
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: /Омлет/ }));

    expect(
      await screen.findByText("продукт удалён из справочника"),
    ).toBeInTheDocument();
    expect(screen.queryByText("название не загрузилось")).toBeNull();
    // И не «выведен из оборота»: это разные события. Вывод говорит, что числа
    // продукта признаны неверными; удаление — что продукта в справочнике нет
    // вовсе. Сказать первое про второе значит выдумать про него утверждение.
    expect(screen.queryByText("выведен из оборота")).toBeNull();
    expect(screen.getByText("120 г")).toBeInTheDocument();
  });

  it("выведенный из оборота продукт помечен в составе", async () => {
    // Вывод убирает продукт из поиска, но не из уже сохранённых рецептов — и
    // правильно: рецепт, по которому кормили, задним числом не подменяется. Но
    // выводят продукт обычно потому, что его числа оказались неверными, а по
    // ним посчитаны показатели рецепта. В кабинете это сказано, в Mini App до
    // сих пор не было — при том что по обеим карточкам готовят.
    (api.GET as Mock).mockImplementation((path: string, options?: unknown) => {
      if (path.endsWith("{recipe_id}"))
        return Promise.resolve({
          data: {
            ...RECIPE,
            ingredients: [
              { product_id: "prod-1", grams: 120, position: 0 },
              { product_id: "prod-2", grams: 60, position: 1 },
            ],
          },
          response: { status: 200 },
        });
      if (path.endsWith("{product_id}")) {
        const id = (options as { params: { path: { product_id: string } } })
          .params.path.product_id;
        return Promise.resolve({
          data: {
            id,
            name_ru: PRODUCT_NAMES[id] ?? "Продукт",
            is_active: id !== "prod-2",
          },
          response: { status: 200 },
        });
      }
      return Promise.resolve({
        data: { items: [RECIPE], total: 1 },
        response: { status: 200 },
      });
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: /Омлет/ }));

    // Пометка стоит у той строки, к которой относится.
    const marks = await screen.findAllByText("выведен из оборота");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.parentElement).toHaveTextContent("Сливки 33%");
    // И предупреждение над составом — чтобы это увидели до готовки.
    expect(
      screen.getByText(/В составе есть выведенный продукт/),
    ).toBeInTheDocument();
    // Имя названо и в строке состава, и в самом предупреждении — обе ссылки на
    // один продукт, поэтому ищем все вхождения, а не одно.
    expect(screen.getAllByText(/Сливки 33%/).length).toBeGreaterThan(1);
  });

  it("граммовка видна, пока имена ещё в пути", async () => {
    // Состав, спрятанный целиком до прихода имён, — карточка без рецепта, а по
    // ней готовят.
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path.endsWith("{recipe_id}"))
        return Promise.resolve({
          response: { status: 200 },
          data: {
            ...RECIPE,
            ingredients: [{ product_id: "prod-1", grams: 120, position: 0 }],
          },
        });
      if (path.endsWith("{product_id}")) return new Promise(() => undefined);
      return Promise.resolve({
        data: { items: [RECIPE], total: 1 },
        response: { status: 200 },
      });
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: /Омлет/ }));

    expect(await screen.findByText("120 г")).toBeInTheDocument();
    expect(screen.getByText("загружаем название…")).toBeInTheDocument();
  });

  it("не дошедшее имя продукта не выдаётся за удалённый продукт", async () => {
    // «Удалён из справочника» — утверждение о справочнике. По этой карточке
    // готовят: неверно названный продукт рядом с граммовкой хуже пустоты.
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path.endsWith("{recipe_id}"))
        return Promise.resolve({
          response: { status: 200 },
          data: {
            ...RECIPE,
            ingredients: [{ product_id: "prod-1", grams: 120, position: 0 }],
          },
        });
      if (path.endsWith("{product_id}"))
        return Promise.reject(new Error("no network"));
      return Promise.resolve({
        data: { items: [RECIPE], total: 1 },
        response: { status: 200 },
      });
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: /Омлет/ }));

    expect(
      await screen.findByText("название не загрузилось"),
    ).toBeInTheDocument();
    expect(screen.queryByText("продукт удалён из справочника")).toBeNull();
    expect(screen.getByText("120 г")).toBeInTheDocument();
  });

  it("сообщение о связи стоит выше содержимого карточки", async () => {
    // Замер на телефонной ширине 390 px: рецепт с инструкцией в 1696 символов
    // даёт 2036 px содержимого, и строка, стоявшая последней, оказывалась на
    // 1972 px от верха — ниже первого экрана любого телефона (667, 844, 932), и
    // это ещё без шапки Telegram. Человек видел карточку, которая молчит, а
    // объяснение лежало двумя экранами ниже. Держит её на виду именно порядок
    // в разметке, поэтому он и проверяется.
    const user = userEvent.setup();
    const { client } = renderScreen();

    await user.click(await screen.findByRole("button", { name: /Омлет/ }));
    await screen.findByText(/Взбить/);
    act(() => {
      showBackButton.mock.calls.at(-1)?.[0]();
    });

    onlineManager.setOnline(false);
    try {
      await user.click(await screen.findByRole("button", { name: /Омлет/ }));

      const note = await screen.findByText(
        "Нет связи — покажем, как только она появится.",
      );
      const body = screen.getByText(/Взбить/);
      expect(
        note.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    } finally {
      client.clear();
      onlineManager.setOnline(true);
    }
  });

  it("карточка без сети тоже говорит про связь", async () => {
    // Со второго открытия рецепт берётся из кэша: `isPending` ложен, ветка
    // кита молчит, и карточка показывала старый рецепт без единого слова — а
    // его могли поправить, и по нему готовят.
    const user = userEvent.setup();
    const { client } = renderScreen();

    await user.click(await screen.findByRole("button", { name: /Омлет/ }));
    await screen.findByText(/Взбить/);
    act(() => {
      showBackButton.mock.calls.at(-1)?.[0]();
    });

    onlineManager.setOnline(false);
    try {
      await user.click(await screen.findByRole("button", { name: /Омлет/ }));

      expect(
        await screen.findByText(
          "Нет связи — покажем, как только она появится.",
        ),
      ).toBeInTheDocument();
    } finally {
      client.clear();
      onlineManager.setOnline(true);
    }
  });

  it("без сети говорит про связь, а не «ничего не нашлось»", async () => {
    // Ветка ожидания в ките сюда не доходит: она требует `loading`, а он со
    // второго поиска ложен. Строка о связи стоит рядом со списком, а пустое
    // состояние на паузе подавлено — иначе оно ответило бы о прежних буквах.
    const user = userEvent.setup();
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
    const { client } = renderScreen();

    const field = await screen.findByLabelText(/Поиск|Найти|рецепт/i);
    await user.type(field, "суфле");
    expect(await screen.findByText("Ничего не нашлось")).toBeInTheDocument();

    onlineManager.setOnline(false);
    try {
      await user.type(field, " творожное");

      expect(
        await screen.findByText(
          "Нет связи — покажем, как только она появится.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText("Ничего не нашлось")).toBeNull();
    } finally {
      client.clear();
      onlineManager.setOnline(true);
    }
  });

  it("пауза при непустой выдаче тоже называется словами", async () => {
    // Прошлый ответ непуст, пустого состояния нет — и о паузе не сказал бы
    // никто: ветка ожидания кита к этому моменту уже не работает.
    const user = userEvent.setup();
    const { client } = renderScreen();

    const field = await screen.findByLabelText(/Поиск|Найти|рецепт/i);
    await user.type(field, "омлет");
    expect(await screen.findByText(/Омлет на сливках/)).toBeInTheDocument();

    onlineManager.setOnline(false);
    try {
      await user.type(field, " на сливках");

      expect(
        await screen.findByText(
          "Нет связи — покажем, как только она появится.",
        ),
      ).toBeInTheDocument();
      // Прежняя выдача остаётся: связь пропала, а не рецепты.
      expect(screen.getByText(/Омлет на сливках/)).toBeInTheDocument();
    } finally {
      client.clear();
      onlineManager.setOnline(true);
    }
  });

  it("в паузу перед запросом не говорит «ничего не нашлось»", async () => {
    // Прошлая выдача держится намеренно, и ответ в паузу был бы о прежних
    // буквах — тот же дрейф, что закрыт в поиске продукта.
    const user = userEvent.setup();
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
    renderScreen();

    const field = await screen.findByLabelText(/Поиск|Найти|рецепт/i);
    await user.type(field, "суфле");
    expect(await screen.findByText("Ничего не нашлось")).toBeInTheDocument();

    await user.type(field, " творожное");

    expect(screen.queryByText("Ничего не нашлось")).toBeNull();
  });

  it("открывает карточку из списка", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: /Омлет на сливках/ }),
    );

    expect(await screen.findByText("Как готовить")).toBeInTheDocument();
  });

  it("показывает порцию, а не весь выход", async () => {
    // У плиты считают порцию; подмена одного другим — ошибка в разы.
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: /Омлет на сливках/ }),
    );

    expect(await screen.findByText("400 ккал")).toBeInTheDocument();
    expect(screen.queryByText("800 ккал")).not.toBeInTheDocument();
  });

  it("перечитывает рецепт при открытии карточки", async () => {
    // Список мог загрузиться час назад, а по рецепту готовят сейчас.
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: /Омлет на сливках/ }),
    );
    await screen.findByText("Как готовить");

    expect(api.GET).toHaveBeenCalledWith(
      "/api/v1/recipes/{recipe_id}",
      expect.objectContaining({
        params: expect.objectContaining({ path: { recipe_id: "r1" } }),
      }),
    );
  });

  it("карточка показывает состав с граммовкой и называет масштаб", async () => {
    // По карточке готовят: показатели порции без «из чего и сколько» —
    // инструкция без рецепта (находка М2 аудита). Рядом стоят показатели
    // ОДНОЙ порции, поэтому заголовок состава называет масштаб — весь выход.
    (api.GET as Mock).mockImplementation((path: string, options?: unknown) => {
      if (path.endsWith("{recipe_id}"))
        return Promise.resolve({
          data: {
            ...RECIPE,
            ingredients: [
              { product_id: "prod-1", grams: 120, position: 0 },
              { product_id: "prod-2", grams: 60, position: 1 },
            ],
          },
          response: { status: 200 },
        });
      if (path.endsWith("{product_id}")) {
        const id = (options as { params: { path: { product_id: string } } })
          .params.path.product_id;
        return Promise.resolve({
          data: {
            id,
            name_ru: PRODUCT_NAMES[id] ?? "Продукт",
            is_active: true,
          },
          response: { status: 200 },
        });
      }
      return Promise.resolve({
        data: { items: [RECIPE], total: 1 },
        response: { status: 200 },
      });
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: /Омлет на сливках/ }),
    );

    expect(
      await screen.findByText(/Состав — на весь выход \(2 порции\)/),
    ).toBeInTheDocument();
    expect(await screen.findByText("Яйцо куриное")).toBeInTheDocument();
    expect(screen.getByText("120 г")).toBeInTheDocument();
    expect(screen.getByText("Сливки 33%")).toBeInTheDocument();
  });

  it("карточка включает системную «Назад» Telegram и она ведёт к списку", async () => {
    // Аппаратная «Назад» на Android иначе закрывает весь Mini App: родитель
    // из карточки попадал в чат, а не к списку (находка М8 аудита).
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: /Омлет на сливках/ }),
    );
    await screen.findByText("Как готовить");

    expect(showBackButton).toHaveBeenCalledTimes(1);
    const [onBack] = showBackButton.mock.calls[0] as [() => void];
    act(() => {
      onBack();
    });

    expect(await screen.findByLabelText("Найдите рецепт")).toBeInTheDocument();
  });

  it("пустая выдача — это «ничего не нашлось», а не ошибка", async () => {
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
    renderScreen();

    expect(await screen.findByText("Ничего не нашлось")).toBeInTheDocument();
  });
});
