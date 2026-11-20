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
    // Значение и способ — одной строкой через «·» (Д2).
    const ketones = await screen.findByRole("article", {
      name: "Кетоны: 3,2 ммоль/л",
    });
    expect(ketones).toHaveTextContent("Кетоны: 3,2 ммоль/л · по крови");
    expect(screen.getByText("Вес: 18,4 кг")).toBeInTheDocument();
    const seizure = screen.getByRole("article", {
      name: "Приступ: Тонико-клонический",
    });
    // Интервал со слов показывается словами, а не пересчитанными секундами
    // (ADR-0020).
    expect(seizure).toHaveTextContent("Длился: от 1 до 5 минут");
    expect(seizure).toHaveTextContent("Сколько раз: 2");
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
        name: "Изменить запись «Кетоны: 3,2 ммоль/л»",
      }),
    ).toBeInTheDocument();
    // Вес записала бабушка: её свидетельство правит она сама.
    expect(
      screen.queryByRole("button", { name: "Изменить запись «Вес: 18,4 кг»" }),
    ).toBeNull();
  });

  it("своя запись открывается всей строкой: ширина остаётся значению", async () => {
    // Отдельная кнопка «Изменить» забирала у значения около ста пикселей на
    // 360 px, и своя запись ломалась на три-четыре строки (Д2).
    renderEntries();

    const row = await screen.findByRole("article", {
      name: "Кетоны: 3,2 ммоль/л",
    });
    const edit = within(row).getByRole("button", {
      name: "Изменить запись «Кетоны: 3,2 ммоль/л»",
    });
    // Кнопка — сама строка: время, значение и карандаш-подсказка внутри неё.
    expect(edit).toHaveTextContent("Кетоны: 3,2 ммоль/л");
    expect(edit).not.toHaveTextContent("Изменить");
    expect(within(row).getAllByRole("button")).toHaveLength(1);
    // Чужая запись — не кнопка.
    const other = screen.getByRole("article", { name: "Вес: 18,4 кг" });
    expect(within(other).queryByRole("button")).toBeNull();
  });

  it("исправление отправляет PATCH с полями этого вида", async () => {
    const user = userEvent.setup();
    renderEntries();

    await user.click(
      await screen.findByRole("button", {
        name: "Изменить запись «Кетоны: 3,2 ммоль/л»",
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
        name: "Изменить запись «Кетоны: 3,2 ммоль/л»",
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
        name: "Изменить запись «Приступ: Тонико-клонический»",
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
        name: "Изменить запись «Приступ: Тонико-клонический»",
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
        name: "Изменить запись «Приступ: Тонико-клонический»",
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

  it("удаление — внутри правки и спрашивает подтверждение с названием записи", async () => {
    const user = userEvent.setup();
    renderEntries();

    // В строке ленты удаления нет: одна кнопка «Изменить» (Д2).
    await screen.findByRole("article", { name: "Кетоны: 3,2 ммоль/л" });
    expect(screen.queryByRole("button", { name: /^Удалить/ })).toBeNull();

    await user.click(
      screen.getByRole("button", {
        name: "Изменить запись «Кетоны: 3,2 ммоль/л»",
      }),
    );
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
    // Правка закрылась вместе с удалённой записью.
    await waitFor(() =>
      expect(screen.queryByLabelText("Кетоны, ммоль/л")).toBeNull(),
    );
  });

  it("отказ от удаления ничего не отправляет", async () => {
    const user = userEvent.setup();
    renderEntries();

    await user.click(
      await screen.findByRole("button", {
        name: "Изменить запись «Кетоны: 3,2 ммоль/л»",
      }),
    );
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
      {
        id: "e2",
        patient_id: PATIENT_ID,
        occurred_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        source: "miniapp",
        created_by: "22222222-2222-4222-8222-222222222222",
        created_at: new Date().toISOString(),
        menu_item_id: "mi2",
        free_text: null,
        parsed: null,
      },
    ];
    (api.GET as Mock).mockImplementation(fakeGet(logs));
    renderEntries();

    const marks = await screen.findAllByRole("article", { name: "Еда" });
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      expect(mark).toHaveTextContent("Еда · Отмечено в меню");
    }
    expect(
      screen.queryByRole("button", { name: "Изменить запись «Еда»" }),
    ).toBeNull();
    // Подсказка — один раз над лентой, а не под каждой отметкой.
    expect(
      screen.getAllByText("Отметки «съедено» исправляют в меню."),
    ).toHaveLength(1);
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

  it("строка — время без даты, автор только у чужой записи", async () => {
    renderEntries();

    const ketones = await screen.findByRole("article", {
      name: "Кетоны: 3,2 ммоль/л",
    });
    const time = within(ketones).getByText(/^\d{2}:\d{2}$/);
    expect(time.tagName).toBe("TIME");
    // День назван заголовком группы — полной даты в строке нет.
    expect(ketones.textContent).not.toMatch(/\d{2}\.\d{2}\.\d{4}/);
    // Своя запись: «Записали вы» не повторяется на каждой строке.
    expect(ketones).not.toHaveTextContent("Записал");
    expect(
      screen.getByRole("article", { name: "Вес: 18,4 кг" }),
    ).toHaveTextContent("Записал(а): Бабушка Галя");
  });

  it("сегодня раскрыто, давние дни свёрнуты в строку и раскрываются", async () => {
    const user = userEvent.setup();
    const logs = defaultLogs();
    const old = new Date();
    old.setDate(old.getDate() - 4);
    old.setHours(10, 56, 0, 0);
    const at = old.toISOString();
    logs.ketones = [
      ...(logs.ketones ?? []),
      {
        ...(logs.ketones?.[0] as object),
        id: "k2",
        occurred_at: at,
        value: 2.4,
      },
      {
        ...(logs.ketones?.[0] as object),
        id: "k3",
        occurred_at: at,
        value: 1.9,
      },
    ];
    logs.weight = [
      ...(logs.weight ?? []),
      { ...(logs.weight?.[0] as object), id: "w2", occurred_at: at },
    ];
    (api.GET as Mock).mockImplementation(fakeGet(logs));
    renderEntries();

    const today = await screen.findByRole("button", { name: /^Сегодня/ });
    expect(today).toHaveAttribute("aria-expanded", "true");

    const older = screen.getByRole("button", {
      name: /3 записи: кетоны 2, вес 1/,
    });
    expect(older).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Кетоны: 2,4 ммоль/л")).toBeNull();

    await user.click(older);
    expect(older).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Кетоны: 2,4 ммоль/л")).toBeInTheDocument();

    // И сворачивается обратно тем же нажатием.
    await user.click(today);
    expect(today).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Кетоны: 3,2 ммоль/л")).toBeNull();
  });

  it("отбор по виду оставляет только записи этого вида", async () => {
    const user = userEvent.setup();
    renderEntries();

    await screen.findByText("Вес: 18,4 кг");
    const filter = screen.getByRole("group", { name: "Какие записи показать" });
    expect(within(filter).getByRole("radio", { name: "Все" })).toBeChecked();
    await user.click(within(filter).getByRole("radio", { name: "Кетоны" }));

    expect(screen.getByText("Кетоны: 3,2 ммоль/л")).toBeInTheDocument();
    expect(screen.queryByText("Вес: 18,4 кг")).toBeNull();
    expect(screen.queryByText("Приступ: Тонико-клонический")).toBeNull();

    await user.click(
      within(filter).getByRole("radio", { name: "Самочувствие" }),
    );
    expect(
      screen.getByText("Записей этого вида за две недели нет."),
    ).toBeInTheDocument();
  });
});
