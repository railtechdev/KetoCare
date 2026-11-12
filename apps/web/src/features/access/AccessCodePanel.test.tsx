import { toast } from "@ketocare/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import accessRu from "../../locales/ru/access.json";
import { AccessCodePanel } from "./AccessCodePanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

vi.mock("@ketocare/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ketocare/ui")>();
  return {
    ...actual,
    toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  };
});

i18n.addResourceBundle("ru", "access", accessRu, true, true);

const PATIENT_ID = "p1";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Через шесть дней от «сейчас»: код в хранилище вкладки ещё не истёк. */
const IN_SIX_DAYS = new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString();

const ISSUED = {
  code: "NEWC0D3S",
  expires_at: IN_SIX_DAYS,
  deep_link: null,
  join_url: "https://app.example.org/join?code=NEWC0D3S",
};

describe("выпуск кода при открытии", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
    (api.GET as Mock).mockResolvedValue({ data: [] });
  });

  it("код выпускается сам, один раз, а кнопка выпускает следующий", async () => {
    // Аудит продукта 12.11.2026: панель открывают ради кода, и вторая кнопка
    // «Дать доступ семье» внутри неё была лишним нажатием.
    (api.POST as Mock).mockResolvedValue({ data: ISSUED, error: undefined });
    const user = userEvent.setup();
    render(<AccessCodePanel patientId={PATIENT_ID} audience="specialist" />, {
      wrapper,
    });

    expect(await screen.findByText("NEWC0D3S")).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Ещё один код" }));
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  });

  it("отказ выпуска оставляет кнопку повтора", async () => {
    (api.POST as Mock).mockResolvedValue({
      error: { error: { code: "internal", message: "Сервер недоступен." } },
    });
    render(<AccessCodePanel patientId={PATIENT_ID} audience="specialist" />, {
      wrapper,
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Сервер недоступен.",
    );
    expect(
      screen.getByRole("button", { name: "Выдать код" }),
    ).toBeInTheDocument();
  });
});

/** Строка журнала для кода `code` в состоянии `status`. */
function journalRow(code: string | null, status: string) {
  return {
    code,
    status,
    purpose: "family_member",
    created_at: "2026-11-10T10:00:00Z",
    expires_at: IN_SIX_DAYS,
    deep_link: null,
    join_url:
      status === "pending" && code !== null
        ? `https://app.example.org/join?code=${code}`
        : null,
  };
}

/** Код, показанный крупно: тот же текст стоит и в журнале ниже. */
function shownCode(): string | undefined {
  return document.querySelector("output")?.textContent ?? undefined;
}

function renderPanel() {
  return render(
    <AccessCodePanel patientId={PATIENT_ID} audience="specialist" />,
    { wrapper },
  );
}

describe("повторное открытие панели не плодит коды", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("показывает код, выпущенный в этой вкладке, пока журнал считает его живым", async () => {
    // Каждый код живёт неделю: пять открытий панели оставляли бы пять дверей.
    (api.GET as Mock).mockResolvedValue({ data: [] });
    (api.POST as Mock).mockResolvedValue({ data: ISSUED, error: undefined });
    const first = renderPanel();
    expect(await screen.findByText("NEWC0D3S")).toBeInTheDocument();
    first.unmount();

    (api.GET as Mock).mockResolvedValue({
      data: [journalRow("NEWC0D3S", "pending")],
    });
    renderPanel();

    await waitFor(() => expect(shownCode()).toBe("NEWC0D3S"));
    expect(api.POST).toHaveBeenCalledTimes(1);
  });

  it("отозванный или погашенный код не показывается — выпускается новый", async () => {
    window.sessionStorage.setItem(
      `ketocare:access-code:${PATIENT_ID}:family_member`,
      JSON.stringify(ISSUED),
    );
    (api.GET as Mock).mockResolvedValue({
      data: [journalRow("NEWC0D3S", "revoked")],
    });
    (api.POST as Mock).mockResolvedValue({
      data: { ...ISSUED, code: "FRESHC0D", join_url: "https://x/join" },
      error: undefined,
    });
    renderPanel();

    expect(await screen.findByText("FRESHC0D")).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledTimes(1);
    expect(shownCode()).toBe("FRESHC0D");
  });

  it("истёкший код из хранилища не показывается — выпускается новый", async () => {
    window.sessionStorage.setItem(
      `ketocare:access-code:${PATIENT_ID}:family_member`,
      JSON.stringify({ ...ISSUED, expires_at: "2020-01-01T00:00:00Z" }),
    );
    // Журнал даже не спрашивается о нём: срок вышел по часам вкладки.
    (api.GET as Mock).mockResolvedValue({
      data: [journalRow("NEWC0D3S", "pending")],
    });
    (api.POST as Mock).mockResolvedValue({
      data: { ...ISSUED, code: "FRESHC0D", join_url: "https://x/join" },
      error: undefined,
    });
    renderPanel();

    expect(await screen.findByText("FRESHC0D")).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledTimes(1);
  });

  it("недоступное хранилище не ломает панель: код просто выпускается", async () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    (api.GET as Mock).mockResolvedValue({ data: [] });
    (api.POST as Mock).mockResolvedValue({ data: ISSUED, error: undefined });
    renderPanel();

    expect(await screen.findByText("NEWC0D3S")).toBeInTheDocument();
    expect(api.POST).toHaveBeenCalledTimes(1);
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("называет число других действующих кодов", async () => {
    window.sessionStorage.setItem(
      `ketocare:access-code:${PATIENT_ID}:family_member`,
      JSON.stringify(ISSUED),
    );
    (api.GET as Mock).mockResolvedValue({
      data: [
        journalRow("NEWC0D3S", "pending"),
        journalRow("OLDC0DE1", "pending"),
        journalRow("OLDC0DE2", "pending"),
        journalRow("USEDC0DE", "used"),
      ],
    });
    renderPanel();

    await waitFor(() => expect(shownCode()).toBe("NEWC0D3S"));
    expect(
      screen.getByText("Ещё действуют 2 кода — отозвать можно в журнале ниже."),
    ).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();
  });
});

describe("отзыв кода доступа", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
    (api.GET as Mock).mockResolvedValue({
      data: [
        {
          code: "ABCD2345",
          status: "pending",
          purpose: "family_member",
          created_at: "2026-10-01T10:00:00Z",
          expires_at: "2026-10-08T10:00:00Z",
          created_by_name: "Врач",
          activated_by_name: null,
          activated_at: null,
        },
      ],
    });
  });

  it("отказ сервера говорит тостом, а не проглатывается", async () => {
    // Прежде ошибка гасилась `.catch(() => null)`: код оставался действующим,
    // а врач считал его отозванным.
    (api.POST as Mock).mockResolvedValue({
      error: { error: { code: "internal", message: "Сервер недоступен." } },
    });
    const user = userEvent.setup();
    render(<AccessCodePanel patientId={PATIENT_ID} audience="specialist" />, {
      wrapper,
    });

    await user.click(await screen.findByRole("button", { name: "Отозвать" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Отозвать" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Сервер недоступен."),
    );
  });

  it("успех подтверждается тостом", async () => {
    (api.POST as Mock).mockImplementation(async (path: string) =>
      path.endsWith("/revoke")
        ? { data: undefined, error: undefined }
        : { data: ISSUED, error: undefined },
    );
    const user = userEvent.setup();
    render(<AccessCodePanel patientId={PATIENT_ID} audience="specialist" />, {
      wrapper,
    });

    await user.click(await screen.findByRole("button", { name: "Отозвать" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Отозвать" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Код ABCD2345 отозван."),
    );
  });
});
