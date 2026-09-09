import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { PatientRouter } from "../../test/PatientRouter";
import { DoctorPatientSwitcher } from "./DoctorPatientSwitcher";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn() } };
});

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const OPEN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

const OPEN = {
  id: OPEN_ID,
  full_name: "Иван Петров",
  birth_date: "2020-05-14",
  sex: "m",
  height_cm: 108,
  allergies: [],
  notes: null,
};

const OTHER = { ...OPEN, id: OTHER_ID, full_name: "Анна Сидорова", sex: "f" };

function renderSwitcher() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PatientRouter patientId={OPEN_ID} view="diary">
          {children}
        </PatientRouter>
      </QueryClientProvider>
    );
  }

  return render(<DoctorPatientSwitcher patientId={OPEN_ID} view="diary" />, {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

function respond(items: unknown[]) {
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path === "/api/v1/patients/{patient_id}") {
      return Promise.resolve({ data: OPEN });
    }
    return Promise.resolve({ data: { items, total: items.length } });
  });
}

describe("переключатель пациента", () => {
  it("называет открытого пациента в шапке", async () => {
    // Чья карта открыта, видно на любой ширине и в любом разделе — в том числе
    // на телефоне, где навигация карты уезжает под содержимое.
    respond([OPEN, OTHER]);
    renderSwitcher();

    expect(await screen.findByText("Иван Петров")).toBeInTheDocument();
  });

  it("не выдаёт сбой сети за «пациентов нет»", async () => {
    // «Не найдено» — утверждение о когорте. Врач, читающий его вместо
    // сообщения о сбое, решает, что пациента нет, и ответ этот выглядит
    // достоверным (правило П15 канона).
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path === "/api/v1/patients/{patient_id}") {
        return Promise.resolve({ data: OPEN });
      }
      return Promise.resolve({ error: { error: { message: "сеть" } } });
    });

    const user = userEvent.setup();
    renderSwitcher();

    await user.click(
      await screen.findByRole("button", { name: /Выбрать другого пациента/ }),
    );

    expect(
      await screen.findByText("Список пациентов загрузить не удалось"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Пациенты не найдены")).not.toBeInTheDocument();
    // У ошибки обязана быть кнопка повтора: иначе выход один — перезагрузка.
    expect(
      screen.getByRole("button", { name: /Повторить/ }),
    ).toBeInTheDocument();
  });

  it("говорит «не найдено», только когда сервер ответил пустым списком", async () => {
    respond([]);

    const user = userEvent.setup();
    renderSwitcher();

    await user.click(
      await screen.findByRole("button", { name: /Выбрать другого пациента/ }),
    );

    expect(await screen.findByText("Пациенты не найдены")).toBeInTheDocument();
  });

  it("отдаёт поиск серверу, а не отбирает загруженную страницу", async () => {
    // Тот же довод, по которому серверным сделан поиск в реестре: своим
    // фильтром переключатель отвечал бы «не найдено» о пациенте, который есть,
    // но не попал в первые двести строк.
    respond([OPEN, OTHER]);

    const user = userEvent.setup();
    renderSwitcher();

    await user.click(
      await screen.findByRole("button", { name: /Выбрать другого пациента/ }),
    );
    await user.type(
      await screen.findByPlaceholderText("Поиск по имени"),
      "сид",
    );

    await vi.waitFor(() => {
      expect(api.GET).toHaveBeenCalledWith(
        "/api/v1/patients",
        expect.objectContaining({
          params: expect.objectContaining({
            query: expect.objectContaining({ q: "сид" }),
          }),
        }),
      );
    });
  });
});
