import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import adminRu from "../../locales/ru/admin.json";
import { SectionRouter } from "../../test/SectionRouter";
import { currentAddress } from "../../test/address";
import type { SectionSearch } from "../../routes/search";
import { AuditPanel } from "./AuditPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

i18n.addResourceBundle("ru", "admin", adminRu, true, true);

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";

const ENTRY = {
  id: "a1",
  user_id: ADMIN_ID,
  action: "update",
  entity: "products",
  entity_id: PRODUCT_ID,
  ip: "10.0.0.1",
  created_at: "2026-09-01T10:00:00Z",
  before: null,
  after: null,
  payload_hidden: false,
};

function renderPanel(search: SectionSearch = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="audit" search={search}>
          {children}
        </SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(<AuditPanel />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path.includes("/admin/users")) {
      return Promise.resolve({
        data: {
          items: [
            {
              id: ADMIN_ID,
              full_name: "Админ Демо",
              email: "admin@example.com",
              role: "admin",
              is_active: true,
              totp_resettable: true,
              sole_patients: 0,
              created_at: "2026-08-01T10:00:00Z",
            },
          ],
          total: 1,
        },
      });
    }
    return Promise.resolve({ data: { items: [ENTRY], total: 1 } });
  });
});

describe("журнал аудита", () => {
  it("называет автора по имени, а не обрезанным идентификатором", async () => {
    // «3f2a…» не отвечает на вопрос «кто это сделал», ради которого журнал и
    // открывают.
    renderPanel();

    expect(await screen.findByText("Админ Демо")).toBeInTheDocument();
  });

  it("из записи о продукте можно перейти к самому продукту", async () => {
    renderPanel();

    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", expect.stringContaining(PRODUCT_ID));
  });

  it("к клинической записи перехода нет: администратору она закрыта", async () => {
    (api.GET as Mock).mockImplementation((path: string) =>
      path.includes("/admin/users")
        ? Promise.resolve({ data: { items: [], total: 0 } })
        : Promise.resolve({
            data: {
              items: [{ ...ENTRY, entity: "prescriptions" }],
              total: 1,
            },
          }),
    );

    renderPanel();

    await screen.findByText(/10\.0\.0\.1/);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("отбор журнала", () => {
  function auditQueries(): Record<string, unknown>[] {
    return (api.GET as Mock).mock.calls
      .filter(([path]) => path === "/api/v1/admin/audit-log")
      .map(
        ([, init]) =>
          (init as { params: { query: Record<string, unknown> } }).params.query,
      );
  }

  it("F5 возвращает автора, объект и период из адреса", async () => {
    renderPanel({
      user: ADMIN_ID,
      entity: "products",
      from: "2026-09-01",
      to: "2026-09-30",
    });

    expect(
      await screen.findByRole("button", { name: /Админ Демо/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Объект")).toHaveValue("products");
    expect(screen.getByLabelText("С даты")).toHaveValue("2026-09-01");
    await waitFor(() =>
      expect(auditQueries()).toContainEqual(
        expect.objectContaining({ user_id: ADMIN_ID, entity: "products" }),
      ),
    );
  });

  it("неизвестный автор и объект в адресе — отбора нет, а не пустая выдача", async () => {
    renderPanel({ user: "иванов", entity: "no_such_table" });

    expect(await screen.findByLabelText("Объект")).toHaveValue("");
    await waitFor(() => expect(auditQueries().length).toBeGreaterThan(0));
    expect(auditQueries()[0]).toMatchObject({
      user_id: undefined,
      entity: undefined,
    });
  });

  it("автор ищется по имени на сервере и уходит в адрес", async () => {
    // Правило П42: раньше автора задавали UUID, набранным руками, — взять его
    // администратору было неоткуда.
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: /Любой автор/ }),
    );
    await user.type(screen.getByPlaceholderText("Имя или почта"), "Адм");
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        "/api/v1/admin/users",
        expect.objectContaining({
          params: expect.objectContaining({
            query: expect.objectContaining({ q: "Адм" }),
          }),
        }),
      ),
    );

    await user.click(await screen.findByRole("option", { name: /Админ Демо/ }));
    await waitFor(() => expect(currentAddress().user).toBe(ADMIN_ID));
  });
});
