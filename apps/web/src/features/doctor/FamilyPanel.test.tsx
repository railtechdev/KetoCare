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
  it("врач выдаёт семье код доступа прямо из карты", async () => {
    // Прежде здесь стояло приглашение по почте: врач набирал чужой адрес при
    // семье, а второй родитель, позванный из списка пациентов, заводил
    // двойника карты (ADR-0040).
    const user = userEvent.setup();
    (api.GET as Mock).mockImplementation(async (path: string) => {
      if (path.endsWith("/access-codes")) return { data: [], error: undefined };
      return {
        data: [
          { id: "p1", full_name: "Мать", phone: null, email: "m@example.com" },
        ],
        error: undefined,
      };
    });
    (api.POST as Mock).mockImplementation(async (path: string) => {
      if (path === "/api/v1/auth/refresh") {
        return { data: { access_token: token }, error: undefined };
      }
      return {
        data: {
          code: "TRWX4K92",
          expires_at: "2026-09-22T10:00:00Z",
          deep_link: "https://t.me/ketocare_bot?start=TRWX4K92",
          join_url: "https://app.example.org/join?code=TRWX4K92",
        },
        error: undefined,
      };
    });

    render(<FamilyPanel patientId={PATIENT_ID} />, { wrapper });

    await user.click(
      await screen.findByRole("button", { name: "Дать доступ семье" }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Дать доступ семье/ }),
    );

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/access-codes",
      { params: { path: { patient_id: PATIENT_ID } } },
    );
    // Код показывается крупно и целиком: врач поворачивает экран к родителю.
    expect(await screen.findByText("TRWX4K92")).toBeInTheDocument();
  });

  /**
   * Родитель из Telegram веб-кабинета не имеет, а отключить потерянный телефон
   * можно было только оттуда. Путь шёл через администратора и отключение всей
   * учётной записи — и всё это время старое устройство писало в дневник.
   */
  it("врач видит устройства семьи и отключает потерянное", async () => {
    (api.GET as Mock).mockImplementation(async (path: string) => {
      if (path === "/api/v1/patients/{patient_id}/telegram") {
        return {
          data: [
            {
              id: "link-1",
              patient_id: PATIENT_ID,
              parent_id: "p1",
              chat_id: 4242,
              linked_at: "2026-09-12T10:00:00Z",
              revoked_at: null,
            },
            {
              id: "link-old",
              patient_id: PATIENT_ID,
              parent_id: "p1",
              chat_id: 4141,
              linked_at: "2026-08-01T10:00:00Z",
              revoked_at: "2026-08-15T10:00:00Z",
            },
          ],
          error: undefined,
        };
      }
      return {
        data: [
          { id: "p1", full_name: "Мать", phone: null, email: null },
          { id: "p2", full_name: "Отец", phone: null, email: "f@example.com" },
        ],
        error: undefined,
      };
    });
    (api.POST as Mock).mockImplementation(async (path: string) => {
      if (path === "/api/v1/auth/refresh") {
        return { data: { access_token: token }, error: undefined };
      }
      return {
        data: { id: "link-1", revoked_at: "2026-09-17T00:00:00Z" },
        error: undefined,
      };
    });

    render(<FamilyPanel patientId={PATIENT_ID} />, { wrapper });

    // Живая привязка видна, отозванная — нет: это история для аудита.
    expect(await screen.findByText(/Telegram подключён/)).toBeInTheDocument();
    expect(screen.getAllByText(/Telegram подключён/)).toHaveLength(1);
    // У отца устройств нет — и об этом сказано, а не промолчано.
    expect(screen.getByText("Telegram не подключён")).toBeInTheDocument();
    // Число чата врачу не показывается: оно ни о чём.
    expect(screen.queryByText(/4242/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Отключить" }));
    // Подтверждение называет родителя, а не спрашивает «вы уверены?».
    expect(
      await screen.findByRole("heading", { name: /Отключить Telegram у Мать/ }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Отключить" }).at(-1)!,
    );

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/telegram/{link_id}/revoke",
      { params: { path: { patient_id: PATIENT_ID, link_id: "link-1" } } },
    );
  });

  it("родителю устройства видны, но кнопки отключить нет — она в его разделе Telegram", async () => {
    token = tokenFor("parent");
    (api.GET as Mock).mockImplementation(async (path: string) => {
      if (path === "/api/v1/patients/{patient_id}/telegram") {
        return {
          data: [
            {
              id: "link-1",
              patient_id: PATIENT_ID,
              parent_id: "p1",
              chat_id: 4242,
              linked_at: "2026-09-12T10:00:00Z",
              revoked_at: null,
            },
          ],
          error: undefined,
        };
      }
      return {
        data: [{ id: "p1", full_name: "Мать", phone: null, email: null }],
        error: undefined,
      };
    });

    render(<FamilyPanel patientId={PATIENT_ID} />, { wrapper });

    expect(await screen.findByText(/Telegram подключён/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Отключить" }),
    ).not.toBeInTheDocument();
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
      screen.queryByRole("button", { name: "Дать доступ семье" }),
    ).not.toBeInTheDocument();
  });
});
