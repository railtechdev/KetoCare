import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@ketocare/ui";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { DiaryEntries } from "./DiaryEntries";
import { PATIENT_ID, SESSION, defaultLogs, fakeGet } from "./testFixtures";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
  };
});

function renderEntries(onAdd: () => void = () => undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
      </QueryClientProvider>
    );
  }
  return render(<DiaryEntries session={SESSION} onAdd={onAdd} />, {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.GET as Mock).mockImplementation(fakeGet());
  (api.PATCH as Mock).mockResolvedValue({ data: {} });
  (api.DELETE as Mock).mockResolvedValue({});
});

describe("записи дневника в Mini App", () => {
  it("показывает записи всех видов простыми словами, по дням", async () => {
    renderEntries();

    expect(
      await screen.findByRole("heading", { name: "Сегодня" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Кетоны: 3,2 ммоль/л")).toBeInTheDocument();
    expect(screen.getByText("по крови")).toBeInTheDocument();
    expect(screen.getByText("Вес: 18,4 кг")).toBeInTheDocument();
    expect(screen.getByText("Приступ: Тонико-клонический")).toBeInTheDocument();
    // Интервал со слов показывается словами, а не пересчитанными секундами
    // (ADR-0020).
    expect(screen.getByText("Длился: от 1 до 5 минут")).toBeInTheDocument();
    expect(screen.getByText("Сколько раз: 2")).toBeInTheDocument();
    expect(screen.getByText("Записал(а): Бабушка Галя")).toBeInTheDocument();

    // Шесть видов — шесть запросов за один и тот же период.
    for (const kind of [
      "seizures",
      "ketones",
      "weight",
      "medications",
      "meals",
      "side-effects",
    ]) {
      expect(api.GET).toHaveBeenCalledWith(
        `/api/v1/patients/{patient_id}/logs/${kind}`,
        expect.anything(),
      );
    }
  });

  it("свою запись можно исправить, чужую — нет", async () => {
    renderEntries();

    expect(
      await screen.findByRole("button", {
        name: "Исправить запись «Кетоны: 3,2 ммоль/л»",
      }),
    ).toBeInTheDocument();
    // Вес записала бабушка: её свидетельство правит она сама.
    expect(
      screen.queryByRole("button", { name: "Исправить запись «Вес: 18,4 кг»" }),
    ).toBeNull();
  });

  it("исправление отправляет PATCH с полями этого вида", async () => {
    const user = userEvent.setup();
    renderEntries();

    await user.click(
      await screen.findByRole("button", {
        name: "Исправить запись «Кетоны: 3,2 ммоль/л»",
      }),
    );
    const value = await screen.findByLabelText("Кетоны, ммоль/л");
    await user.clear(value);
    await user.type(value, "2.5");
    await user.selectOptions(screen.getByLabelText("Как мерили"), "urine");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.PATCH).toHaveBeenCalledTimes(1));
    expect(api.PATCH).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/logs/ketones/{log_id}",
      {
        params: { path: { patient_id: PATIENT_ID, log_id: "k1" } },
        body: {
          occurred_at: expect.any(String) as string,
          value: 2.5,
          method: "urine",
        },
      },
    );
    expect(await screen.findByText("Запись исправлена")).toBeInTheDocument();
  });

  it("значение вне границ не уходит на сервер", async () => {
    const user = userEvent.setup();
    renderEntries();

    await user.click(
      await screen.findByRole("button", {
        name: "Исправить запись «Кетоны: 3,2 ммоль/л»",
      }),
    );
    const value = await screen.findByLabelText("Кетоны, ммоль/л");
    await user.clear(value);
    await user.type(value, "20");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(await screen.findByText("Число от 0 до 12.")).toBeInTheDocument();
    expect(api.PATCH).not.toHaveBeenCalled();
  });

  it("у приступа длительность — выбор «засекали / со слов», а не два поля", async () => {
    // Измеренное и со слов — разные величины (ADR-0020). Прежде на шаге
    // стояли оба поля и подсказка «не оба сразу»; теперь выбор делается
    // словами, и переключение очищает второе значение.
    const user = userEvent.setup();
    renderEntries();

    await user.click(
      await screen.findByRole("button", {
        name: "Исправить запись «Приступ: Тонико-клонический»",
      }),
    );
    // Запись со слов: открыт интервал, поля секунд нет вовсе.
    expect(await screen.findByLabelText(/^Примерно/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Сколько длился, секунды/)).toBeNull();

    await user.click(screen.getByLabelText("Засекали по часам"));
    expect(screen.queryByLabelText(/^Примерно/)).toBeNull();
    await user.type(screen.getByLabelText(/Сколько длился, секунды/), "90");
    await user.click(screen.getByRole("button", { name: "Далее" }));
    await user.click(await screen.findByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.PATCH).toHaveBeenCalledTimes(1));
    expect(api.PATCH).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/logs/seizures/{log_id}",
      expect.objectContaining({
        body: expect.objectContaining({
          duration_sec: 90,
          duration_option_id: null,
        }) as object,
      }),
    );
  });

  it("на шаге приступа не больше трёх полей", async () => {
    // Правило семьи: не больше трёх полей на экран формы (раздел 8.2 ТЗ).
    const user = userEvent.setup();
    renderEntries();

    await user.click(
      await screen.findByRole("button", {
        name: "Исправить запись «Приступ: Тонико-клонический»",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await screen.findByLabelText(/^Примерно/);
    const fields = dialog.querySelectorAll(
      'input:not([type="radio"]), select, textarea',
    );
    expect(fields.length).toBeLessThanOrEqual(3);
  });

  it("приступ сохраняется в два шага и с интервалом, а не секундами", async () => {
    const user = userEvent.setup();
    renderEntries();

    await user.click(
      await screen.findByRole("button", {
        name: "Исправить запись «Приступ: Тонико-клонический»",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Далее" }));
    const count = await screen.findByLabelText("Сколько раз");
    await user.clear(count);
    await user.type(count, "3");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.PATCH).toHaveBeenCalledTimes(1));
    expect(api.PATCH).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/logs/seizures/{log_id}",
      expect.objectContaining({
        body: expect.objectContaining({
          seizure_type_id: "t1",
          duration_sec: null,
          duration_option_id: "d1",
          count: 3,
        }) as object,
      }),
    );
  });

  it("удаление спрашивает подтверждение с названием записи", async () => {
    const user = userEvent.setup();
    renderEntries();

    await user.click(
      await screen.findByRole("button", {
        name: "Удалить запись «Кетоны: 3,2 ммоль/л»",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("Удалить запись «Кетоны: 3,2 ммоль/л»?"),
    ).toBeInTheDocument();
    expect(api.DELETE).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole("button", { name: "Да, удалить" }),
    );

    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/logs/ketones/{log_id}",
        { params: { path: { patient_id: PATIENT_ID, log_id: "k1" } } },
      ),
    );
    expect(await screen.findByText("Запись удалена")).toBeInTheDocument();
  });

  it("отказ от удаления ничего не отправляет", async () => {
    const user = userEvent.setup();
    renderEntries();

    await user.click(
      await screen.findByRole("button", {
        name: "Удалить запись «Кетоны: 3,2 ммоль/л»",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Отмена" }));

    expect(api.DELETE).not.toHaveBeenCalled();
  });

  it("отметку «съедено» из плана дня здесь не правят", async () => {
    const logs = defaultLogs();
    logs.meals = [
      {
        id: "e1",
        patient_id: PATIENT_ID,
        occurred_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        source: "miniapp",
        created_by: "22222222-2222-4222-8222-222222222222",
        created_at: new Date().toISOString(),
        menu_item_id: "mi1",
        free_text: null,
        parsed: null,
      },
    ];
    (api.GET as Mock).mockImplementation(fakeGet(logs));
    renderEntries();

    expect(await screen.findByText("Отмечено в плане дня")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Исправить запись «Еда»" }),
    ).toBeNull();
    expect(
      screen.getByText(/поправить её можно на вкладке/),
    ).toBeInTheDocument();
  });

  it("без записей ведёт к добавлению, а не в бот", async () => {
    // Прежде пустой дневник отправлял в бот — тупик для того, кто открыл
    // приложение, а не чат (дополнение к ADR-0044 от 07.10.2026).
    (api.GET as Mock).mockImplementation(fakeGet({}));
    const onAdd = vi.fn();
    const user = userEvent.setup();
    renderEntries(onAdd);

    expect(
      await screen.findByText("За две недели записей нет"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/в боте/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Добавить запись" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
