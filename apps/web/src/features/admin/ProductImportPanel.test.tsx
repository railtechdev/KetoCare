import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import adminRu from "../../locales/ru/admin.json";
import { nativeSelect } from "../../test/nativeSelect";
import {
  DEFAULT_FOOD_STANDARD_ID,
  type FoodStandard,
} from "../standards/useFoodStandards";
import { ProductImportPanel } from "./ProductImportPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "admin", adminRu, true, true);

const importRu = adminRu.products.import;

const MAIN: FoodStandard = {
  id: DEFAULT_FOOD_STANDARD_ID,
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
  products: 99,
  created_at: "2026-11-09T00:00:00Z",
};
const OPEN_SOURCE: FoodStandard = {
  ...MAIN,
  id: "55555555-5555-4555-8555-555555555555",
  name: "Таблицы клиники 2026",
  kind: "reference",
};
const LOCKED_SOURCE: FoodStandard = {
  ...OPEN_SOURCE,
  id: "66666666-6666-4666-8666-666666666666",
  name: "USDA FoodData Central SR Legacy",
  locked_at: "2026-11-10T00:00:00Z",
};
const RETIRED_SOURCE: FoodStandard = {
  ...OPEN_SOURCE,
  id: "77777777-7777-4777-8777-777777777777",
  name: "Старые таблицы",
  is_active: false,
};
const STANDARDS = [MAIN, OPEN_SOURCE, LOCKED_SOURCE, RETIRED_SOURCE];

function renderPanel(initialStandardId?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <ProductImportPanel
      onDone={() => {}}
      standards={STANDARDS}
      initialStandardId={initialStandardId}
    />,
    { wrapper: Wrapper },
  );
}

const REPORT = {
  total_rows: 3,
  imported: 0,
  updated: 3,
  dry_run: true,
  errors: [],
  warnings: [],
  updates: [],
};

async function checkAndConfirm() {
  const user = userEvent.setup();
  renderPanel();
  await user.upload(
    screen.getByLabelText(importRu.file),
    new File(["name_ru\n"], "products.csv", { type: "text/csv" }),
  );
  await user.click(screen.getByRole("button", { name: importRu.check }));
  await screen.findByText(importRu.preview.title);
  return user;
}

describe("импорт продуктов", () => {
  beforeEach(() => vi.clearAllMocks());

  it("обновляющий импорт без новых строк — не «ничего не записано»", async () => {
    // Прежде баннер отказа смотрел только на `imported`: обновление трёх
    // позиций сообщало, что импорт не удался.
    (api.POST as Mock).mockResolvedValue({ data: REPORT });
    const user = await checkAndConfirm();

    (api.POST as Mock).mockResolvedValue({
      data: { ...REPORT, dry_run: false },
    });
    await user.click(screen.getByRole("button", { name: importRu.confirm }));

    expect(await screen.findByText(importRu.result.title)).toBeInTheDocument();
    expect(screen.queryByText(importRu.result.failed)).toBeNull();
  });

  it("во время записи говорит «Импортируем», а не «Проверяем»", async () => {
    (api.POST as Mock).mockResolvedValue({ data: REPORT });
    const user = await checkAndConfirm();

    (api.POST as Mock).mockReturnValue(new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: importRu.confirm }));

    expect(
      await screen.findByRole("button", { name: importRu.importing }),
    ).toBeInTheDocument();
    expect(screen.queryByText(importRu.checking)).toBeNull();
  });

  it("куда загрузить — поле формы, по умолчанию открытый в списке источник", async () => {
    // Прежде цель решал отбор над таблицей, и файл уезжал туда, где случайно
    // стоял фильтр (ADR-0073).
    (api.POST as Mock).mockResolvedValue({ data: REPORT });
    const user = userEvent.setup();
    renderPanel(OPEN_SOURCE.id);

    const target = nativeSelect(screen.getByLabelText(importRu.target));
    expect(target).toHaveValue(OPEN_SOURCE.id);
    // Заблокированный и убранный в архив файл не примут — их нет в выборе.
    const options = Array.from(target.options).map((option) => option.text);
    expect(options).toEqual([MAIN.name, OPEN_SOURCE.name]);

    await user.selectOptions(target, MAIN.id);
    await user.upload(
      screen.getByLabelText(importRu.file),
      new File(["name_ru\n"], "products.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: importRu.check }));

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/products/import",
      expect.objectContaining({
        params: {
          query: {
            dry_run: true,
            update_existing: false,
            standard_id: undefined,
          },
        },
      }),
    );
  });

  it("выбранный источник уходит в запрос, а смена цели снимает прежний отчёт", async () => {
    (api.POST as Mock).mockResolvedValue({ data: REPORT });
    const user = userEvent.setup();
    renderPanel();

    const target = nativeSelect(screen.getByLabelText(importRu.target));
    expect(target).toHaveValue(MAIN.id);
    await user.selectOptions(target, OPEN_SOURCE.id);
    await user.upload(
      screen.getByLabelText(importRu.file),
      new File(["name_ru\n"], "products.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: importRu.check }));
    await screen.findByText(importRu.preview.title);

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/products/import",
      expect.objectContaining({
        params: {
          query: {
            dry_run: true,
            update_existing: false,
            standard_id: OPEN_SOURCE.id,
          },
        },
      }),
    );

    await user.selectOptions(target, MAIN.id);
    expect(screen.queryByText(importRu.preview.title)).toBeNull();
  });

  it("заблокированный источник из списка не становится целью", () => {
    renderPanel(LOCKED_SOURCE.id);

    expect(nativeSelect(screen.getByLabelText(importRu.target))).toHaveValue(
      MAIN.id,
    );
  });
});
