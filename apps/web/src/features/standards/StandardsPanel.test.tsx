import { Toaster } from "@ketocare/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import productsRu from "../../locales/ru/products.json";
import { StandardsPanel } from "./StandardsPanel";
import { newEditionValues } from "./standardSchema";
import type { FoodStandard } from "./useFoodStandards";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() } };
});

const session = vi.hoisted(() => ({ role: "admin" }));
vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "u-1", role: session.role } }),
}));

i18n.addResourceBundle("ru", "products", productsRu, true, true);

const labels = productsRu.standards;

const MAIN: FoodStandard = {
  id: "00000000-0000-7000-8000-000000000001",
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
const DOCUMENT: FoodStandard = {
  ...MAIN,
  id: "55555555-5555-4555-8555-555555555555",
  name: "Меню детских садов 2025",
  publisher: "Минздрав",
  version: "2025",
  kind: "reference",
  diet_type: "general",
  carbs_convention: "unknown",
  products: 36,
};

function renderPanel(onOpen = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
      </QueryClientProvider>
    );
  }
  render(<StandardsPanel onOpen={onOpen} />, { wrapper: Wrapper });
  return onOpen;
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  session.role = "admin";
  (api.GET as Mock).mockResolvedValue({
    data: [MAIN, DOCUMENT],
    response: { status: 200 },
  });
});

describe("стандарты питания", () => {
  it("называет питание стандарта и ведёт к его продуктам", async () => {
    const user = userEvent.setup();
    const onOpen = renderPanel();

    await screen.findByText(DOCUMENT.name);
    expect(
      within(rowOf(DOCUMENT.name)).getByText(labels.diet.general),
    ).toBeInTheDocument();

    await user.click(
      within(rowOf(DOCUMENT.name)).getByRole("button", {
        name: `${labels.actions.open}: ${DOCUMENT.name}`,
      }),
    );
    expect(onOpen).toHaveBeenCalledWith(DOCUMENT.id);
  });

  it("закрыть можно только внешний документ", async () => {
    renderPanel();
    await screen.findByText(DOCUMENT.name);

    expect(
      within(rowOf(DOCUMENT.name)).getByRole("button", {
        name: `${labels.actions.lock}: ${DOCUMENT.name}`,
      }),
    ).toBeInTheDocument();
    expect(
      within(rowOf(MAIN.name)).queryByRole("button", {
        name: `${labels.actions.lock}: ${MAIN.name}`,
      }),
    ).not.toBeInTheDocument();
  });

  it("диетологу закрытие не предлагается", async () => {
    session.role = "dietitian";
    renderPanel();
    await screen.findByText(DOCUMENT.name);

    expect(
      screen.queryByRole("button", {
        name: `${labels.actions.lock}: ${DOCUMENT.name}`,
      }),
    ).not.toBeInTheDocument();
  });

  it("основной стандарт нельзя снять с оборота", async () => {
    renderPanel();
    await screen.findByText(MAIN.name);

    expect(
      screen.queryByRole("button", {
        name: `${labels.actions.retire}: ${MAIN.name}`,
      }),
    ).not.toBeInTheDocument();
  });

  it("в архив — только после подтверждения, и об успехе сказано", async () => {
    // Источник пропадает из выбора у всех: одно случайное нажатие в строке
    // таблицы прежде делало это молча (ADR-0072).
    const user = userEvent.setup();
    (api.PUT as Mock).mockResolvedValue({
      data: { ...DOCUMENT, is_active: false },
    });
    renderPanel();
    await screen.findByText(DOCUMENT.name);

    await user.click(
      within(rowOf(DOCUMENT.name)).getByRole("button", {
        name: `${labels.actions.retire}: ${DOCUMENT.name}`,
      }),
    );
    expect(api.PUT).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        labels.confirmRetire.title.replace("{{name}}", DOCUMENT.name),
      ),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", {
        name: labels.confirmRetire.confirm,
      }),
    );
    await waitFor(() =>
      expect(api.PUT).toHaveBeenCalledWith(
        "/api/v1/food-standards/{standard_id}",
        expect.objectContaining({
          body: expect.objectContaining({ is_active: false }),
        }),
      ),
    );
    expect(
      await screen.findByText(
        labels.retired.replace("{{name}}", DOCUMENT.name),
      ),
    ).toBeInTheDocument();
  });

  it("вернуть из архива можно без вопроса", async () => {
    const user = userEvent.setup();
    (api.GET as Mock).mockResolvedValue({
      data: [MAIN, { ...DOCUMENT, is_active: false }],
    });
    (api.PUT as Mock).mockResolvedValue({ data: DOCUMENT });
    renderPanel();
    await screen.findByText(DOCUMENT.name);

    await user.click(
      within(rowOf(DOCUMENT.name)).getByRole("button", {
        name: `${labels.actions.restore}: ${DOCUMENT.name}`,
      }),
    );

    await waitFor(() =>
      expect(api.PUT).toHaveBeenCalledWith(
        "/api/v1/food-standards/{standard_id}",
        expect.objectContaining({
          body: expect.objectContaining({ is_active: true }),
        }),
      ),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("у закрытого стандарта нет правки описания", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: [{ ...DOCUMENT, locked_at: "2026-11-10T00:00:00Z" }],
      response: { status: 200 },
    });
    renderPanel();
    await screen.findByText(DOCUMENT.name);

    expect(
      screen.queryByRole("button", {
        name: `${labels.actions.edit}: ${DOCUMENT.name}`,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `${labels.actions.edition}: ${DOCUMENT.name}`,
      }),
    ).toBeInTheDocument();
  });

  it("пустое название останавливается в форме", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(MAIN.name);

    await user.click(screen.getByRole("button", { name: labels.create }));
    await user.click(await screen.findByRole("button", { name: "Сохранить" }));

    expect(
      (await screen.findAllByText(labels.form.nameRequired)).length,
    ).toBeGreaterThan(0);
    expect(api.POST).not.toHaveBeenCalled();
  });

  it("новый стандарт уходит на сервер с описанием", async () => {
    (api.POST as Mock).mockResolvedValue({
      data: MAIN,
      response: { status: 201 },
    });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(MAIN.name);

    await user.click(screen.getByRole("button", { name: labels.create }));
    await user.type(
      await screen.findByLabelText(new RegExp(labels.form.name)),
      "Местные продукты",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith("/api/v1/food-standards", {
        body: expect.objectContaining({
          name: "Местные продукты",
          kind: "clinic",
          diet_type: "ketogenic",
          carbs_convention: "total",
          publisher: null,
        }),
      }),
    );
  });

  it("новая редакция наследует документ, но не название и версию", () => {
    const values = newEditionValues(DOCUMENT);

    expect(values).toMatchObject({
      name: "",
      version: "",
      publisher: "Минздрав",
      kind: "reference",
      dietType: "general",
      carbsConvention: "unknown",
    });
  });
});
