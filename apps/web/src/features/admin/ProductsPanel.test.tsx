import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { NetworkError } from "@ketocare/api-client";
import { api } from "../../lib/api";
import type { ProductDetail } from "../products/useProductDetail";
import adminRu from "../../locales/ru/admin.json";
import { SectionRouter } from "../../test/SectionRouter";
import { currentAddress } from "../../test/address";
import type { FoodStandard } from "../standards/useFoodStandards";
import { ProductsPanel } from "./ProductsPanel";
import { nativeSelect, valueControl } from "../../test/nativeSelect";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() } };
});

vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "admin-1", role: "admin" } }),
}));

i18n.addResourceBundle("ru", "admin", adminRu, true, true);

// Категория — UUID: схема требует именно его, а аннотация типом формат не
// ловит (uuid, дата, диапазоны в тип не попадают).
const CATEGORY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OUTSIDE_ID = "33333333-3333-4333-8333-333333333333";

const PRODUCT: ProductDetail = {
  id: OUTSIDE_ID,
  name_ru: "Масло сливочное",
  name_uz: null,
  name_en: null,
  category_id: CATEGORY_ID,
  kcal_100g: 748,
  fat_100g: 82.5,
  protein_100g: 0.5,
  carbs_100g: 0.8,
  fiber_100g: 0,
  source: "USDA",
  source_version: "2024",
  verified_at: "2026-01-10",
  is_active: true,
  counts_in_calculation: true,
  standard_id: "00000000-0000-7000-8000-000000000001",
  food_id: "00000000-0000-4000-8000-0000000000f1",
  fiber_known: true,
  // Соотношение производно от макронутриентов этой же позиции, и ядро его НЕ
  // округляет. Поэтому здесь выражение, а не число: записанное числом, оно
  // разошлось бы и с сервером, и с собственным пояснением, стоило бы поправить
  // граммовку.
  ratio: 82.5 / (0.5 + 0.8),
};

const LOCKED_ID = "44444444-4444-4444-8444-444444444444";
const MAIN_STANDARD_ID = "00000000-0000-7000-8000-000000000001";

function standardRow(extra: Partial<FoodStandard>): FoodStandard {
  return {
    id: MAIN_STANDARD_ID,
    name: "Справочник клиники",
    publisher: null,
    document: null,
    version: null,
    effective_on: null,
    kind: "clinic",
    diet_type: "ketogenic",
    carbs_convention: "total",
    locked_at: null,
    is_active: true,
    products: 1,
    created_at: "2026-11-09T00:00:00Z",
    ...extra,
  };
}

const standards: FoodStandard[] = [
  standardRow({}),
  standardRow({
    id: LOCKED_ID,
    name: "Меню детских садов 2025",
    kind: "reference",
    diet_type: "general",
    carbs_convention: "unknown",
    locked_at: "2026-11-10T00:00:00Z",
  }),
];

function renderPanel(
  item?: string,
  canImport = true,
  extraSearch: Record<string, string> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {/* Без `item` панель показывает СПИСОК; с `item` — карточку позиции.
            Ветка выбирается в самой панели, поэтому параметр нельзя подменить
            пустой строкой: она тоже «задана». */}
        <SectionRouter
          section="products"
          search={{ ...(item === undefined ? {} : { item }), ...extraSearch }}
        >
          {children}
        </SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<ProductsPanel canImport={canImport} />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  // `response` в подмене обязателен: настоящий клиент отдаёт его всегда, а
  // запрос карточки различает по нему 404 («такого продукта нет») и сбой
  // связи. Мок без `response` — форма, которой в бою не бывает.
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path === "/api/v1/products/{product_id}") {
      return Promise.resolve({ data: PRODUCT, response: { status: 200 } });
    }
    if (path === "/api/v1/products/categories") {
      return Promise.resolve({
        data: [{ id: CATEGORY_ID, name_ru: "Жиры" }],
        response: { status: 200 },
      });
    }
    if (path === "/api/v1/food-standards") {
      return Promise.resolve({
        data: standards,
        response: { status: 200 },
      });
    }
    // Выборка без искомой позиции: другая страница, другой фильтр.
    return Promise.resolve({
      data: { items: [], total: 0 },
      response: { status: 200 },
    });
  });
});

describe("карточка продукта вне текущей выборки", () => {
  it("дочитывается по идентификатору, а не открывает форму заведения", async () => {
    // Раньше ссылка на строку с другой страницы открывала пустую форму
    // «Новый продукт», и администратор заводил дубль вместо правки.
    renderPanel(OUTSIDE_ID);

    expect(
      await screen.findByDisplayValue("Масло сливочное"),
    ).toBeInTheDocument();
  });

  it("несуществующая позиция объясняет себя и даёт выход", async () => {
    // `response` обязателен и здесь: без него проверка проходила только
    // потому, что запрос карточки спотыкался на `response.status` и падал —
    // то есть про 404 она ничего не проверяла, хотя так и называется.
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path === "/api/v1/food-standards") {
        return Promise.resolve({ data: standards, response: { status: 200 } });
      }
      if (path === "/api/v1/products/{product_id}") {
        return Promise.resolve({
          error: { error: { code: "not_found", message: "Нет." } },
          response: { status: 404 },
        });
      }
      if (path === "/api/v1/products/categories") {
        return Promise.resolve({
          data: [{ id: CATEGORY_ID, name_ru: "Жиры" }],
          response: { status: 200 },
        });
      }
      return Promise.resolve({
        data: { items: [], total: 0 },
        response: { status: 200 },
      });
    });

    renderPanel(OUTSIDE_ID);

    expect(await screen.findByText("Продукт не найден")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "К списку продуктов" }),
    ).toBeInTheDocument();
  });

  it("выключенный импорт по адресу импорта не оставляет экран в ожидании", async () => {
    // Каталог продуктов (`CatalogPage`) отдаёт панель с `canImport={false}` —
    // это экран диетолога. Адрес `?item=import` туда попадает легко:
    // пересланная ссылка, закладка, возврат по истории. Ветка импорта при
    // выключенной возможности не срабатывает, а дальше `item` уже задан:
    // запрос карточки выключен, `isPending` у выключенного запроса истинен, и
    // экран остаётся скелетоном навсегда — без объяснения и без выхода.
    //
    // Для такого пользователя `import` — не идентификатор позиции, а
    // неизвестный адрес, и отвечать на него надо как на неизвестный.
    renderPanel("import", false);

    expect(
      await screen.findByText(adminRu.products.notFound),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: adminRu.products.backToList }),
    ).toBeInTheDocument();
  });

  it("тот же адрес с правом импорта открывает панель импорта", async () => {
    // Обратная половина того же обещания. «Импорт — только администратору»
    // держалось чтением кода на стыке: `CatalogPage` передаёт `canImport`,
    // а панель решает сама. Ни один тест не падал бы, откройся импорт не тому
    // или перестань открываться тому, кому положен.
    renderPanel("import", true);

    expect(
      await screen.findByText(adminRu.products.import.title),
    ).toBeInTheDocument();
  });

  it("отказ связи говорит про связь, а не про отсутствие позиции", async () => {
    // «Позиция не найдена» — утверждение о справочнике. Когда ответ не доехал,
    // о справочнике не известно ничего, а администратору говорилось именно
    // это, и повторить было нечем. 404 и отказ различает сам запрос
    // (`fetchProductDetail`), панели остаётся их не смешивать.
    //
    // Отказ подделан `NetworkError` — именно её бросает клиент при обрыве
    // связи, и только для неё `errorMessageOf` даёт текст про связь. С обычной
    // `Error` проверка про отказ связи как раз путь отказа связи и не прошла бы
    // (правило: подделка обязана повторять контракт, а не представление о нём).
    let attempts = 0;
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path === "/api/v1/food-standards") {
        return Promise.resolve({ data: standards, response: { status: 200 } });
      }
      if (path === "/api/v1/products/{product_id}") {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new NetworkError())
          : Promise.resolve({ data: PRODUCT, response: { status: 200 } });
      }
      if (path === "/api/v1/products/categories") {
        return Promise.resolve({
          data: [{ id: CATEGORY_ID, name_ru: "Жиры" }],
          response: { status: 200 },
        });
      }
      return Promise.resolve({
        data: { items: [], total: 0 },
        response: { status: 200 },
      });
    });

    const user = userEvent.setup();
    renderPanel(OUTSIDE_ID);

    expect(
      await screen.findByText(adminRu.products.cardError as string),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Нет связи. Проверьте интернет."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Продукт не найден")).toBeNull();

    // Кнопка обязана не просто быть, а повторять запрос: вся находка была в
    // том, что повторить было нечем.
    await user.click(screen.getByRole("button", { name: /Повторить/ }));

    expect(
      await screen.findByDisplayValue("Масло сливочное"),
    ).toBeInTheDocument();
    expect(attempts).toBe(2);
  });
});

/**
 * «Богатые белками / жирами / углеводами» — просьба заказчицы, чтобы менять один
 * продукт на другой по роли в блюде.
 *
 * Отбирает СЕРВЕР. Это не оптимизация: страница таблицы — двадцать строк, и
 * фильтрация полученного дала бы «жировые из тех двадцати, что попали на экран».
 * Диетолог решил бы, что жировых продуктов в справочнике три.
 */
describe("отбор из адреса", () => {
  it("ссылка «не сверялись» и строка поиска доходят до запроса", async () => {
    // Главная администратора ведёт сюда со счётчиком несверенных позиций,
    // калькулятор — со своим запросом. Прежде панель не читала адрес вовсе.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(<ProductsPanel />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <SectionRouter
            section="products"
            search={{ q: "масло", verified: "2025-10-07" }}
          >
            {children}
          </SectionRouter>
        </QueryClientProvider>
      ),
    });

    expect(
      await screen.findByRole("button", {
        name: /Не сверялись с 07\.10\.2025/,
      }),
    ).toBeInTheDocument();
    await waitFor(() => {
      const asked = (api.GET as Mock).mock.calls.some(
        ([path, options]) =>
          path === "/api/v1/products" &&
          (options as { params: { query: Record<string, unknown> } }).params
            .query.verified_before === "2025-10-07" &&
          (options as { params: { query: Record<string, unknown> } }).params
            .query.q === "масло",
      );
      expect(asked).toBe(true);
    });
  });
});

describe("отбор по ведущему макронутриенту", () => {
  it("уходит в запрос, а не применяется к полученной странице", async () => {
    const user = userEvent.setup();
    renderPanel();

    await screen.findByLabelText(adminRu.products.filters.macro);
    await user.selectOptions(
      nativeSelect(screen.getByLabelText(adminRu.products.filters.macro)),
      "protein",
    );

    await waitFor(() => {
      const asked = (api.GET as Mock).mock.calls.some(
        ([path, options]) =>
          path === "/api/v1/products" &&
          (options as { params: { query: Record<string, unknown> } }).params
            .query.macro === "protein",
      );
      expect(asked).toBe(true);
    });
  });

  it("по умолчанию не задан — справочник не сужается молча", async () => {
    renderPanel();

    await screen.findByLabelText(adminRu.products.filters.macro);
    const first = (api.GET as Mock).mock.calls.find(
      ([path]) => path === "/api/v1/products",
    );
    expect(
      (first?.[1] as { params: { query: Record<string, unknown> } }).params
        .query.macro,
    ).toBeUndefined();
  });

  it("правило объясняется рядом с отобранным, и только когда отбор задан", async () => {
    // Диетолог должен понимать, по какому признаку отобрано: порога «богатый»
    // у нас нет, и «Жиры» без пояснения читалось бы как порог. Но до выбора
    // объяснять нечего — строка появляется вместе с отбором.
    const user = userEvent.setup();
    renderPanel();

    const select = await screen.findByLabelText(adminRu.products.filters.macro);
    expect(screen.queryByText(/больше всего калорий/)).not.toBeInTheDocument();

    await user.selectOptions(nativeSelect(select), "fat");

    const explains = await screen.findByText(/больше всего калорий/);
    // Название макронутриента подставляется в строку: без него она читается
    // «…больше всего калорий приходится на .» — и проверки по «не порог» это
    // не заметят.
    expect(explains).toHaveTextContent(/на жиры/);
    expect(explains).toHaveTextContent(/не порог/);
    // Скринридер должен услышать правило вместе с подписью списка.
    expect(select).toHaveAttribute("aria-describedby", explains.id);
  });

  it("варианты подписаны словами, а не ключами словаря", async () => {
    // Подписи собираются шаблоном (`macroValue.${macro}`), и проверка
    // неиспользованных ключей до вложенных не достаёт: пропавший ключ показал
    // бы диетологу «products.filters.macroValue.fat» в выпадающем списке, и
    // ничего бы не упало.
    renderPanel();

    const select = await screen.findByLabelText(adminRu.products.filters.macro);
    expect(
      [...nativeSelect(select).querySelectorAll("option")].map(
        (o) => o.textContent,
      ),
    ).toEqual([
      adminRu.products.filters.macroAny,
      adminRu.products.filters.macroValue.fat,
      adminRu.products.filters.macroValue.protein,
      adminRu.products.filters.macroValue.carbs,
    ]);
    expect(select.textContent).not.toMatch(/macroValue/);
  });
});

describe("отборы справочника — в адресе", () => {
  function productQueries(): Record<string, unknown>[] {
    return (api.GET as Mock).mock.calls
      .filter(([path]) => path === "/api/v1/products")
      .map(
        ([, options]) =>
          (options as { params: { query: Record<string, unknown> } }).params
            .query,
      );
  }

  it("F5 возвращает категорию, макронутриент и выведенные", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(<ProductsPanel />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <SectionRouter
            section="products"
            search={{ category: CATEGORY_ID, macro: "fat", inactive: true }}
          >
            {children}
          </SectionRouter>
        </QueryClientProvider>
      ),
    });

    expect(
      valueControl(
        await screen.findByLabelText(adminRu.products.filters.macro),
      ),
    ).toHaveValue("fat");
    expect(
      screen.getByLabelText(adminRu.products.filters.includeInactive),
    ).toBeChecked();
    await waitFor(() =>
      expect(productQueries()).toContainEqual(
        expect.objectContaining({
          category_id: CATEGORY_ID,
          macro: "fat",
        }),
      ),
    );
  });

  it("выбор уходит в адрес, снятие — убирает параметр", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(
      nativeSelect(
        await screen.findByLabelText(adminRu.products.filters.macro),
      ),
      "protein",
    );
    await waitFor(() => expect(currentAddress().macro).toBe("protein"));

    const inactive = screen.getByLabelText(
      adminRu.products.filters.includeInactive,
    );
    await user.click(inactive);
    await waitFor(() => expect(currentAddress().inactive).toBe(true));
    await user.click(inactive);
    await waitFor(() => expect(currentAddress().inactive).toBeUndefined());
  });

  it("категория из строки таблицы не сбрасывает уже заданные отборы", async () => {
    const listless = (api.GET as Mock).getMockImplementation()!;
    (api.GET as Mock).mockImplementation((path: string, ...rest: unknown[]) =>
      path === "/api/v1/products"
        ? Promise.resolve({
            data: { items: [PRODUCT], total: 1 },
            response: { status: 200 },
          })
        : listless(path, ...rest),
    );
    const user = userEvent.setup();
    renderPanel();

    // Кнопок с такой подписью в таблице несколько; нужна ссылка из строки.
    const categoryLink = async () => {
      const buttons = await screen.findAllByRole("button", { name: "Жиры" });
      return buttons.find((button) => button.dataset.variant === "link")!;
    };
    // Сначала дождаться строки: колонки собраны, отбор включается уже после.
    await categoryLink();
    await user.click(
      screen.getByLabelText(adminRu.products.filters.includeInactive),
    );
    await waitFor(() => expect(currentAddress().inactive).toBe(true));

    await user.click(await categoryLink());

    await waitFor(() => expect(currentAddress().category).toBe(CATEGORY_ID));
    expect(currentAddress().inactive).toBe(true);
  });
});

describe("стандарт питания в справочнике", () => {
  const LOCKED_PRODUCT = { ...PRODUCT, standard_id: LOCKED_ID };

  function withRows(rows: ProductDetail[]) {
    const base = (api.GET as Mock).getMockImplementation()!;
    (api.GET as Mock).mockImplementation((path: string, ...rest: unknown[]) =>
      path === "/api/v1/products"
        ? Promise.resolve({
            data: { items: rows, total: rows.length },
            response: { status: 200 },
          })
        : base(path, ...rest),
    );
  }

  it("запрашивает выбранный стандарт и держит его в адресе", async () => {
    const user = userEvent.setup();
    renderPanel();

    await screen.findByRole("option", {
      hidden: true,
      name: "Меню детских садов 2025",
    });
    await user.selectOptions(
      nativeSelect(screen.getByLabelText(adminRu.products.filters.standard)),
      LOCKED_ID,
    );

    await waitFor(() => expect(currentAddress().standard).toBe(LOCKED_ID));
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith("/api/v1/products", {
        params: {
          query: expect.objectContaining({ standard_id: LOCKED_ID }),
        },
      }),
    );
  });

  it("закрытый обычный стандарт предупреждает и не предлагает добавить", async () => {
    withRows([LOCKED_PRODUCT]);
    renderPanel(undefined, true, { standard: LOCKED_ID });

    expect(
      await screen.findByText(adminRu.products.standardBanner.generalTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(adminRu.products.standardBanner.lockedTitle),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: adminRu.products.derive }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: adminRu.products.edit }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: adminRu.products.create }),
    ).not.toBeInTheDocument();
  });

  it("клетчатка, которой источник не указал, не выглядит нулём", async () => {
    withRows([{ ...PRODUCT, fiber_known: false }]);
    renderPanel();

    expect(
      await screen.findByText(adminRu.products.fiberUnknown),
    ).toBeInTheDocument();
  });

  it("запись закрытого стандарта сохраняется копией, а не правкой", async () => {
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path === "/api/v1/food-standards") {
        return Promise.resolve({ data: standards, response: { status: 200 } });
      }
      if (path === "/api/v1/products/{product_id}") {
        return Promise.resolve({
          data: LOCKED_PRODUCT,
          response: { status: 200 },
        });
      }
      if (path === "/api/v1/products/categories") {
        return Promise.resolve({
          data: [{ id: CATEGORY_ID, name_ru: "Жиры" }],
          response: { status: 200 },
        });
      }
      return Promise.resolve({
        data: { items: [], total: 0 },
        response: { status: 200 },
      });
    });
    (api.POST as Mock).mockResolvedValue({
      data: { ...LOCKED_PRODUCT, derived_from_id: OUTSIDE_ID },
      response: { status: 201 },
    });
    const user = userEvent.setup();
    renderPanel(OUTSIDE_ID);

    expect(
      await screen.findByText(adminRu.products.form.deriveTitle),
    ).toBeInTheDocument();
    // Оригинал из обычного стандарта, копия идёт в основной: её увидят семьи.
    expect(
      screen.getByText(adminRu.products.form.deriveGeneralTitle),
    ).toBeInTheDocument();
    await screen.findAllByRole("option", { hidden: true, name: "Жиры" });
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/products/{product_id}/derive",
        expect.objectContaining({
          params: { path: { product_id: OUTSIDE_ID } },
          body: expect.objectContaining({ standard_id: MAIN_STANDARD_ID }),
        }),
      ),
    );
    expect(api.PUT).not.toHaveBeenCalled();
  });
});
