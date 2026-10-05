import { Toaster } from "@ketocare/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../lib/i18n";
import type { Session } from "../session/useSession";
import { FamilyBlock } from "./FamilyBlock";

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const del = vi.hoisted(() => vi.fn());

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: get, POST: post, DELETE: del } };
});

const session: Session = {
  patientId: "11111111-1111-1111-1111-111111111111",
  patientName: "Амина",
  children: [],
  webUrl: "https://ketocare.example",
  hasWebCredentials: false,
};

const MEMBERS = [
  {
    id: "me",
    full_name: "Анна",
    phone: null,
    email: null,
    invited_by_name: "Врач Иванов",
    is_me: true,
    can_remove: true,
  },
  {
    id: "grandma",
    full_name: "Мария",
    phone: null,
    email: null,
    invited_by_name: "Анна",
    is_me: false,
    can_remove: true,
  },
  {
    id: "father",
    full_name: "Олег",
    phone: null,
    email: null,
    invited_by_name: "Врач Иванов",
    is_me: false,
    can_remove: false,
  },
];

function renderBlock() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
      </QueryClientProvider>
    );
  }
  return render(<FamilyBlock session={session} />, { wrapper: Wrapper });
}

afterEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "Telegram");
});

/**
 * Семья из Telegram кабинета не имеет — пригласить бабушку ей было нечем
 * (аудит пути, 02.10.2026). Приглашение уходит из того же приложения обычным
 * сообщением, как у Apple Health и Medisafe (ADR-0043).
 */
describe("близкие в Mini App", () => {
  it("видно, кто ведёт ребёнка и кто кого позвал", async () => {
    get.mockResolvedValue({ data: MEMBERS });
    renderBlock();

    expect(await screen.findByText("Анна (вы)")).toBeInTheDocument();
    expect(screen.getByText("Пригласил(а): Анна")).toBeInTheDocument();
    // Себе «Выйти» здесь не предлагается — приложение оборвалось бы на полуслове.
    // Закрыть доступ можно только бабушке: её позвала Анна.
    expect(
      screen.getAllByRole("button", { name: "Закрыть доступ" }),
    ).toHaveLength(1);
  });

  it("закрыть доступ — с подтверждением, называющим человека", async () => {
    get.mockResolvedValue({ data: MEMBERS });
    del.mockResolvedValue({ error: undefined });
    renderBlock();

    await userEvent.click(
      await screen.findByRole("button", { name: "Закрыть доступ" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Закрыть доступ для Мария?",
      }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Закрыть доступ" }).at(-1)!,
    );

    expect(del).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/parents/{parent_id}",
      {
        params: {
          path: { patient_id: session.patientId, parent_id: "grandma" },
        },
      },
    );
  });

  it("приглашение уходит в окно Telegram «Переслать» со ссылкой и шагами", async () => {
    const openTelegramLink = vi.fn();
    Object.defineProperty(window, "Telegram", {
      value: { WebApp: { openTelegramLink } },
      configurable: true,
    });
    get.mockResolvedValue({ data: MEMBERS });
    post.mockResolvedValue({
      data: {
        code: "BABU5K92",
        expires_at: "2026-10-09T10:00:00Z",
        deep_link: "https://t.me/ketocare_bot?start=BABU5K92",
        join_url: "https://app.example/join?code=BABU5K92",
      },
    });
    renderBlock();

    await userEvent.click(
      await screen.findByRole("button", { name: "Пригласить близкого" }),
    );
    expect(post).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/access-codes",
      {
        params: { path: { patient_id: session.patientId } },
        body: { purpose: "family_member" },
      },
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Отправить приглашение" }),
    );

    expect(openTelegramLink).toHaveBeenCalledTimes(1);
    const target = new URL(String(openTelegramLink.mock.calls[0]?.[0]));
    expect(target.origin + target.pathname).toBe("https://t.me/share/url");
    expect(target.searchParams.get("url")).toBe(
      "https://t.me/ketocare_bot?start=BABU5K92",
    );
    // Шаги для бабушки — в самом сообщении: читать их будет она.
    expect(target.searchParams.get("text")).toContain("«Запустить»");
    expect(target.searchParams.get("text")).toContain("BABU5K92");
    // Код виден и на экране — на случай, если человек рядом.
    expect(screen.getByText("BABU5K92")).toBeInTheDocument();
  });

  it("отказ сервера объясняется его словами, а не пустотой", async () => {
    get.mockResolvedValue({ data: MEMBERS });
    post.mockResolvedValue({
      error: {
        error: {
          code: "forbidden",
          message: "Код доступа выдаётся в приложении или в веб-кабинете.",
        },
      },
    });
    renderBlock();

    await userEvent.click(
      await screen.findByRole("button", { name: "Пригласить близкого" }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
