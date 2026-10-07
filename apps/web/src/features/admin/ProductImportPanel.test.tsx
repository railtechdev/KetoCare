import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import adminRu from "../../locales/ru/admin.json";
import { ProductImportPanel } from "./ProductImportPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "admin", adminRu, true, true);

const importRu = adminRu.products.import;

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<ProductImportPanel onDone={() => {}} />, { wrapper: Wrapper });
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
});
