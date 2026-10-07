import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { api } from "../../lib/api";
import "../../lib/i18n";
import { SectionRouter } from "../../test/SectionRouter";
import { PatientGate } from "./PatientGate";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

const CHILD = { id: "c1", full_name: "Аня" };

function renderGate(client: QueryClient, search: { patient?: string } = {}) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SectionRouter section="menu" search={search}>
          {children}
        </SectionRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <PatientGate render={(id) => <p>{`экран ребёнка ${id}`}</p>} />,
    { wrapper: Wrapper },
  );
}

describe("PatientGate", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => onlineManager.setOnline(true));

  it("без сети — ожидание связи, а не вечный скелетон", async () => {
    onlineManager.setOnline(false);
    (api.GET as Mock).mockResolvedValue({ data: { items: [], total: 0 } });
    renderGate(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );

    expect(await screen.findByText(/Нет связи/)).toBeInTheDocument();
    expect(screen.queryByText(/Ребёнка ещё нет/)).toBeNull();
  });

  it("неудачное обновление списка не прячет открытый экран", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: { items: [CHILD], total: 1 },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderGate(client);
    expect(await screen.findByText("экран ребёнка c1")).toBeInTheDocument();

    (api.GET as Mock).mockResolvedValue({
      error: { error: { code: "internal", message: "сбой" } },
    });
    await act(async () => {
      await client.refetchQueries({ queryKey: ["patients"] });
    });

    // Прежде экран ребёнка заменялся ошибкой — вместе с недописанной формой.
    expect(
      await screen.findByRole("button", { name: "Повторить" }),
    ).toBeInTheDocument();
    expect(screen.getByText("экран ребёнка c1")).toBeInTheDocument();
  });

  it("ребёнок из ссылки, которого нет среди своих, назван ненайденным", async () => {
    // Прежде экран молча просил «выберите ребёнка», как будто ссылка верная.
    (api.GET as Mock).mockResolvedValue({
      data: {
        items: [CHILD, { id: "c2", full_name: "Боря" }],
        total: 2,
      },
    });
    renderGate(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      { patient: "чужой" },
    );

    expect(
      await screen.findByText("Ребёнок по ссылке не найден"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Аня" })).toBeInTheDocument();
  });
});
