import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import i18n from "../../lib/i18n";
import diaryRu from "../../locales/ru/diary.json";
import { SectionRouter } from "../../test/SectionRouter";
import { SessionProvider } from "../auth/session";
import { DiaryPage } from "./DiaryPage";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() } };
});

i18n.addResourceBundle("ru", "diary", diaryRu, true, true);

const KETONE_LOG = {
  id: "log-1",
  patient_id: "p1",
  occurred_at: "2026-08-29T07:00:00Z",
  value: 3.2,
  method: "blood",
  author_user_id: "u1",
  created_at: "2026-08-29T07:00:00Z",
};

function respond(path: string) {
  if (path === "/api/v1/patients/{patient_id}/logs/ketones") {
    return { data: { items: [KETONE_LOG], total: 1 } };
  }
  if (path.startsWith("/api/v1/patients/{patient_id}/logs/")) {
    return { data: { items: [], total: 0 } };
  }
  if (path === "/api/v1/patients/{patient_id}/prescriptions") {
    return { data: { items: [], total: 0 } };
  }
  if (path === "/api/v1/patients/{patient_id}/medications") {
    return { data: { items: [], total: 0 } };
  }
  if (path === "/api/v1/dictionaries/seizure-types") {
    return { data: { items: [], total: 0 } };
  }
  return { data: { items: [], total: 0 } };
}

function renderPage(search: { kind?: string } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <SectionRouter section="diary" search={search}>
          <DiaryPage patientId="p1" />
        </SectionRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

describe("DiaryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.GET as unknown as Mock).mockImplementation((path: string) =>
      Promise.resolve(respond(path)),
    );
    // Восстановление сессии уходит на сервер при монтировании провайдера:
    // без ответа тест падал бы на разборе `undefined`, а не на своей проверке.
    (api.POST as unknown as Mock).mockResolvedValue({ error: {} });
  });

  it("открывает вид записей из адреса", async () => {
    // Ровно та ошибка, ради которой вкладка переехала в адрес: параметр `kind`
    // отбрасывался проверкой поиска маршрута, и быстрая кнопка главной
    // «Записать кетоны» открывала дневник на вкладке «Приступы».
    renderPage({ kind: "ketones" });

    expect(await screen.findByRole("tab", { name: "Кетоны" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("без параметра открывает приступы", async () => {
    renderPage();

    expect(
      await screen.findByRole("tab", { name: "Приступы" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("форма не занимает экран, пока её не открыли", async () => {
    // Правило П32: раньше форма стояла раскрытой между фильтром и списком и
    // занимала 58 % высоты экрана — родитель приходил смотреть записи, а
    // получал ввод.
    const user = userEvent.setup();
    renderPage({ kind: "ketones" });

    // Список — то, за чем пришли: он на экране до всякой формы.
    expect((await screen.findAllByText(/3,2|3\.2/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Добавить запись" }));

    expect(
      await screen.findByRole("dialog", { name: "Новая запись" }),
    ).toBeInTheDocument();
  });
});
