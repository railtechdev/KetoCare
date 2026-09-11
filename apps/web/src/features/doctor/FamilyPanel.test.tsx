import { Toaster } from "@ketocare/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import doctorRu from "../../locales/ru/doctor.json";
import { SessionProvider } from "../auth/session";
import { FamilyPanel } from "./FamilyPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn() } };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";

function tokenFor(role: string): string {
  return `header.${btoa(JSON.stringify({ sub: ME, role }))}.signature`;
}

let token = tokenFor("doctor");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      {/* Роль нужна панели, чтобы решить, показывать ли приглашение: сессия
          восстанавливается тем же обменом refresh-cookie, что в приложении. */}
      <SessionProvider>
        {children}
        <Toaster />
      </SessionProvider>
    </QueryClientProvider>
  );
}

/**
 * Красный флаг «семья молчит N дней» стоял первой строкой списка, а следующего
 * шага не существовало: ни телефона, ни почты, ни имени того, кто ведёт
 * ребёнка. Триаж заканчивался констатацией проблемы (ADR-0011).
 */
describe("кто ведёт ребёнка дома", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    token = tokenFor("doctor");
    (api.POST as Mock).mockImplementation(async (path: string) => {
      if (path === "/api/v1/auth/refresh") {
        return { data: { access_token: token }, error: undefined };
      }
      return { data: undefined, error: undefined };
    });
  });

  it("даёт позвонить и написать, а не переписывать номер", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: [
        {
          id: "p1",
          full_name: "Мария Иванова",
          phone: "+998901234567",
          email: "maria@example.com",
        },
      ],
      error: undefined,
    });

    render(<FamilyPanel patientId={PATIENT_ID} />, { wrapper });

    // Врач звонит с того же устройства, на котором смотрит карту.
    expect(
      await screen.findByRole("link", { name: /\+998901234567/ }),
    ).toHaveAttribute("href", "tel:+998901234567");
    expect(
      screen.getByRole("link", { name: /maria@example.com/ }),
    ).toHaveAttribute("href", "mailto:maria@example.com");
  });

  it("без телефона показывает почту, а не прочерк", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: [
        { id: "p1", full_name: "Отец", phone: null, email: "dad@example.com" },
      ],
      error: undefined,
    });

    render(<FamilyPanel patientId={PATIENT_ID} />, { wrapper });

    // Прочерк читался бы как «связаться нельзя», хотя канал есть.
    expect(
      await screen.findByRole("link", { name: /dad@example.com/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^tel:/ }),
    ).not.toBeInTheDocument();
  });

  it("показывает обоих родителей", async () => {
    (api.GET as Mock).mockResolvedValue({
      data: [
        { id: "p1", full_name: "Мать", phone: null, email: "m@example.com" },
        { id: "p2", full_name: "Отец", phone: null, email: "f@example.com" },
      ],
      error: undefined,
    });

    render(<FamilyPanel patientId={PATIENT_ID} />, { wrapper });

    // Связь многие-ко-многим: молчать может один из двоих.
    expect(await screen.findByText("Мать")).toBeInTheDocument();
    expect(screen.getByText("Отец")).toBeInTheDocument();
  });

  /**
   * Второго родителя приглашают из карты ребёнка (ответ клиники на вопрос 33,
   * ADR-0032): приглашение из списка пациентов зовёт первого родителя, и
   * позванный так второй заводил двойника.
   */
  it("врач приглашает второго родителя к этому ребёнку", async () => {
    const user = userEvent.setup();
    (api.GET as Mock).mockResolvedValue({
      data: [
        { id: "p1", full_name: "Мать", phone: null, email: "m@example.com" },
      ],
      error: undefined,
    });
    (api.POST as Mock).mockImplementation(async (path: string) => {
      if (path === "/api/v1/auth/refresh") {
        return { data: { access_token: token }, error: undefined };
      }
      return {
        data: {
          id: "inv1",
          email: "dad@example.com",
          role: "parent",
          token: "secret-token",
          expires_at: "2026-09-18T10:00:00Z",
          patient_id: PATIENT_ID,
        },
        error: undefined,
      };
    });

    render(<FamilyPanel patientId={PATIENT_ID} />, { wrapper });

    await user.click(
      await screen.findByRole("button", {
        name: "Пригласить родителя",
      }),
    );
    await user.type(
      await screen.findByLabelText("Электронная почта"),
      "dad@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Создать приглашение" }),
    );

    expect(api.POST).toHaveBeenCalledWith("/api/v1/auth/invitations", {
      body: {
        email: "dad@example.com",
        role: "parent",
        patient_id: PATIENT_ID,
      },
    });
    expect(await screen.findByText(/secret-token/)).toBeInTheDocument();
  });

  it("семье приглашать некого — кнопки нет", async () => {
    token = tokenFor("parent");
    (api.GET as Mock).mockResolvedValue({
      data: [
        { id: "p1", full_name: "Мать", phone: null, email: "m@example.com" },
      ],
      error: undefined,
    });

    render(<FamilyPanel patientId={PATIENT_ID} />, { wrapper });

    expect(await screen.findByText("Мать")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Пригласить родителя" }),
    ).not.toBeInTheDocument();
  });
});
