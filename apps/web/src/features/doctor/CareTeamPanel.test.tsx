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
import { CareTeamPanel } from "./CareTeamPanel";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
  };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const MINE = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const ACCESS_TOKEN = `header.${btoa(
  JSON.stringify({ sub: MINE, role: "doctor" }),
)}.signature`;

const PARENT_TOKEN = `header.${btoa(
  JSON.stringify({ sub: MINE, role: "parent" }),
)}.signature`;

const TEAM = [{ id: MINE, role: "doctor", full_name: "Иван Врач" }];
const COLLEAGUES = [
  ...TEAM,
  { id: OTHER, role: "dietitian", full_name: "Анна Диетолог" },
];

let token = ACCESS_TOKEN;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      {/* Сессия восстанавливается тем же путём, что и в приложении: обменом
          httpOnly refresh-cookie на access-токен. Роль нужна панели, чтобы
          решить, показывать ли действия (правило П3 канона). */}
      <SessionProvider>
        {children}
        <Toaster />
      </SessionProvider>
    </QueryClientProvider>
  );
}

describe("кто ведёт пациента", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    token = ACCESS_TOKEN;
    (api.POST as Mock).mockImplementation(async (path: string) => {
      if (path === "/api/v1/auth/refresh") {
        return { data: { access_token: token }, error: undefined };
      }
      return { data: undefined, error: undefined };
    });
    (api.GET as Mock).mockImplementation(async (path: string) =>
      path.includes("colleagues")
        ? { data: COLLEAGUES, error: undefined }
        : { data: TEAM, error: undefined },
    );
  });

  it("не предлагает подключить того, кто уже ведёт пациента", async () => {
    const user = userEvent.setup();
    render(<CareTeamPanel patientId={PATIENT_ID} />, { wrapper });

    await screen.findByText("Иван Врач");
    await user.click(
      screen.getByRole("button", { name: /Подключить коллегу/ }),
    );

    // Повторное подключение сервер отвергнет, а список из двух строк, одна из
    // которых заведомо не работает, — предложение выбрать ошибку.
    expect(
      await screen.findByRole("option", { name: /Анна Диетолог/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Иван Врач/ }),
    ).not.toBeInTheDocument();
  });

  it("родителю показывает состав, но не даёт его менять", async () => {
    // Ручка `/patients/{id}/doctors` родителю прямо разрешена: он вправе знать,
    // кто имеет доступ к данным его ребёнка. Действия при этом чужие — сервер
    // ответил бы 403, а кнопка обещала бы то, чего нет (правило П3 канона).
    token = PARENT_TOKEN;
    render(<CareTeamPanel patientId={PATIENT_ID} />, { wrapper });

    expect(await screen.findByText("Иван Врач")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Подключить коллегу/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Снять ведение/ }),
    ).not.toBeInTheDocument();
  });

  it("показывает отказ сервера снять последнего специалиста", async () => {
    const user = userEvent.setup();
    (api.DELETE as Mock).mockResolvedValue({
      data: undefined,
      error: {
        error: {
          code: "conflict",
          message: "Нельзя снять последнего специалиста.",
        },
      },
    });

    render(<CareTeamPanel patientId={PATIENT_ID} />, { wrapper });

    await screen.findByText("Иван Врач");
    await user.click(
      screen.getByRole("button", { name: "Снять ведение: Иван Врач" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Снять ведение" }),
    );

    // Причина отказа — единственное, что объясняет врачу, почему ничего не
    // произошло. Дублировать проверку на клиенте нельзя: она разошлась бы с
    // серверной, и врач увидел бы запрет там, где сервер разрешает.
    expect(
      await screen.findByText(/Нельзя снять последнего специалиста/),
    ).toBeInTheDocument();
  });
});
