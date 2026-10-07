import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import authRu from "../../locales/ru/auth.json";
import {
  AccountNotices,
  unseenNotices,
  type AccountNotice,
} from "./AccountNotices";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

i18n.addResourceBundle("ru", "auth", authRu, true, true);

const RESET: AccountNotice = {
  kind: "password_reset",
  at: "2026-10-05T09:20:00Z",
  count: null,
};
const MOVED: AccountNotice = {
  kind: "care_handed_over",
  at: "2026-10-03T08:00:00Z",
  count: 3,
};

function renderNotices() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<AccountNotices userId="u-1" />, { wrapper: Wrapper });
}

describe("сообщения о действиях администратора (Н5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("называет действие и предлагает позвонить в клинику", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: [RESET, MOVED],
      error: undefined,
    });
    renderNotices();

    expect(
      await screen.findByText(/выдан временный пароль/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ваши пациенты переданы коллеге: 3/),
    ).toBeInTheDocument();
    expect(screen.getByText(/позвоните в клинику/)).toBeInTheDocument();
  });

  it("закрытое не возвращается, пока не случится новое", async () => {
    (api.GET as Mock).mockResolvedValue({ data: [RESET], error: undefined });
    const user = userEvent.setup();
    const { unmount } = renderNotices();

    await user.click(await screen.findByRole("button", { name: "Понятно" }));
    expect(screen.queryByText(/временный пароль/)).not.toBeInTheDocument();
    unmount();

    renderNotices();
    await vi.waitFor(() => expect(api.GET).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/временный пароль/)).not.toBeInTheDocument();
  });

  it("закрытое одним сотрудником не прячет сообщения другого", async () => {
    // Компьютер в клинике общий (замечание ревью).
    window.localStorage.setItem("kc.accountNotices.seenUpTo.u-2", RESET.at);
    (api.GET as Mock).mockResolvedValue({ data: [RESET], error: undefined });
    renderNotices();

    expect(
      await screen.findByText(/выдан временный пароль/),
    ).toBeInTheDocument();
  });

  it("молчит, когда сообщать нечего или запрос не удался", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: undefined,
      error: { error: { code: "internal" } },
    });
    const { container } = renderNotices();

    await vi.waitFor(() => expect(api.GET).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("отбирает только то, что новее закрытого", () => {
    expect(unseenNotices([RESET, MOVED], null)).toEqual([RESET, MOVED]);
    expect(unseenNotices([RESET, MOVED], MOVED.at)).toEqual([RESET]);
    expect(unseenNotices([RESET, MOVED], RESET.at)).toEqual([]);
  });
});
