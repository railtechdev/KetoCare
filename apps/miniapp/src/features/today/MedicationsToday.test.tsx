import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toDateInput } from "@ketocare/ui";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { ME, PATIENT_ID, SESSION } from "../diary/testFixtures";
import { MedicationsToday } from "./MedicationsToday";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() },
  };
});

function shifted(days: number): string {
  const day = new Date();
  day.setDate(day.getDate() + days);
  return toDateInput(day);
}

function medication(
  id: string,
  name: string,
  extra: Partial<Record<string, unknown>> = {},
) {
  return {
    id,
    patient_id: PATIENT_ID,
    drug_name: name,
    dose: "150 мг",
    dose_value: 150,
    dose_unit: "mg",
    frequency_code: "twice_daily",
    frequency: "утром и на ночь",
    started_at: shifted(-30),
    stopped_at: null,
    author_id: "doctor",
    created_at: "2026-10-01T08:00:00Z",
    ...extra,
  };
}

function at(hours: number, minutes: number): string {
  const moment = new Date();
  moment.setHours(hours, minutes, 0, 0);
  return moment.toISOString();
}

function mark(id: string, medicationId: string, taken: boolean, when: string) {
  return {
    id,
    patient_id: PATIENT_ID,
    occurred_at: when,
    source: "miniapp",
    created_by: ME,
    created_at: when,
    medication_id: medicationId,
    taken,
  };
}

function serve(medications: unknown[], logs: unknown[] = []) {
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path.endsWith("/logs/medications")) {
      return Promise.resolve({ data: { items: logs, total: logs.length } });
    }
    if (path.endsWith("/medications")) {
      return Promise.resolve({
        data: { items: medications, total: medications.length },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

function renderBlock() {
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
  return render(<MedicationsToday session={SESSION} />, { wrapper: Wrapper });
}

/** Тело и ключ последнего POST. */
function lastPost(): {
  path: string;
  body: Record<string, unknown>;
  key: string;
} {
  const call = (api.POST as Mock).mock.calls.at(-1) as [
    string,
    {
      params: { header: Record<string, string> };
      body: Record<string, unknown>;
    },
  ];
  return {
    path: call[0],
    body: call[1].body,
    key: call[1].params.header["Idempotency-Key"] ?? "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.POST as Mock).mockResolvedValue({ data: { id: "log-new" } });
  (api.DELETE as Mock).mockResolvedValue({});
});

describe("«Лекарства сегодня» на главной Mini App (Д4)", () => {
  it("показывает только препараты, которые принимаются сегодня", async () => {
    serve([
      medication("m1", "Депакин"),
      medication("m2", "Отменённый", { stopped_at: shifted(-1) }),
      medication("m3", "Будущий", { started_at: shifted(1) }),
      medication("m4", "Последний день", { stopped_at: shifted(0) }),
    ]);
    renderBlock();

    expect(
      await screen.findByRole("heading", { name: "Лекарства сегодня" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Депакин")).toBeInTheDocument();
    expect(screen.getByText("Последний день")).toBeInTheDocument();
    expect(screen.queryByText("Отменённый")).toBeNull();
    expect(screen.queryByText("Будущий")).toBeNull();
    // Сервер тоже отбирает по дню — тем же правилом.
    expect(api.GET).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/medications",
      expect.objectContaining({
        params: expect.objectContaining({
          query: expect.objectContaining({ active_on: shifted(0) }),
        }),
      }),
    );
  });

  it("без препаратов на сегодня блока нет вовсе", async () => {
    serve([medication("m2", "Отменённый", { stopped_at: shifted(-1) })]);
    renderBlock();

    await waitFor(() => expect(api.GET).toHaveBeenCalled());
    // Дождаться ответа: блок молчит и пока ждёт, и когда отмечать нечего.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      screen.queryByRole("heading", { name: "Лекарства сегодня" }),
    ).toBeNull();
  });

  it("доза, кратность словами и сегодняшние отметки", async () => {
    serve(
      [medication("m1", "Депакин")],
      [mark("l2", "m1", false, at(14, 0)), mark("l1", "m1", true, at(8, 10))],
    );
    renderBlock();

    // Имя с дозой — одной строкой, кратность — под ними.
    expect((await screen.findByText("Депакин")).closest("p")).toHaveTextContent(
      "Депакин · 150 мг",
    );
    expect(
      screen.getByText("2 раза в сутки — утром и на ночь"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("дали в 08:10, пропустили в 14:00"),
    ).toBeInTheDocument();
  });

  it("«Дали» пишет запись с ключом попытки, «Отменить» её удаляет", async () => {
    const user = userEvent.setup();
    serve([medication("m1", "Депакин")]);
    renderBlock();

    await user.click(
      await screen.findByRole("button", { name: "Дали: Депакин" }),
    );

    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    const post = lastPost();
    expect(post.path).toBe("/api/v1/patients/{patient_id}/logs/medications");
    expect(post.body).toMatchObject({ medication_id: "m1", taken: true });
    expect(typeof post.body.occurred_at).toBe("string");
    expect(post.key).not.toBe("");

    const toastText = await screen.findByText("Отмечено: дали Депакин");
    const toastItem = toastText.closest("li") ?? document.body;
    // Нажатие — без жеста указателя: у sonner свайп ловит pointerdown, а в
    // jsdom нет `setPointerCapture`.
    fireEvent.click(
      within(toastItem as HTMLElement).getByRole("button", {
        name: "Отменить",
      }),
    );
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/logs/medications/{log_id}",
        { params: { path: { patient_id: PATIENT_ID, log_id: "log-new" } } },
      ),
    );
    expect(await screen.findByText("Отметка отменена")).toBeInTheDocument();
  });

  it("«Пропустили» — запись с taken: false и своим ключом", async () => {
    const user = userEvent.setup();
    serve([medication("m1", "Депакин")]);
    renderBlock();

    await user.click(
      await screen.findByRole("button", { name: "Дали: Депакин" }),
    );
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    const first = lastPost().key;

    await user.click(
      await screen.findByRole("button", { name: "Пропустили: Депакин" }),
    );
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
    expect(lastPost().body).toMatchObject({
      medication_id: "m1",
      taken: false,
    });
    // Два нажатия — две отметки, а не повтор первой.
    expect(lastPost().key).not.toBe(first);
  });

  it("у препарата «по требованию» только «Дали»", async () => {
    serve([
      medication("m5", "Диазепам", {
        frequency_code: "as_needed",
        frequency: null,
      }),
    ]);
    renderBlock();

    expect(
      await screen.findByRole("button", { name: "Дали: Диазепам" }),
    ).toBeInTheDocument();
    expect(screen.getByText("По требованию")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Пропустили: Диазепам" }),
    ).toBeNull();
  });

  it("два препарата подряд: у каждого своё сообщение и своя «Отменить»", async () => {
    // Утренние препараты дают вместе и отмечают подряд. Общая мутация с
    // колбэками на вызов теряла сообщение первого, стоило нажать второй.
    const user = userEvent.setup();
    serve([medication("m1", "КонвулексА"), medication("m2", "ЛеветирацетамА")]);
    let answerFirst: (value: unknown) => void = () => undefined;
    (api.POST as Mock)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ data: { id: "log-b" } });
    renderBlock();

    await user.click(
      await screen.findByRole("button", { name: "Дали: КонвулексА" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Дали: ЛеветирацетамА" }),
    );
    expect(
      await screen.findByText("Отмечено: дали ЛеветирацетамА"),
    ).toBeInTheDocument();

    // Первая отметка ещё в пути — её кнопки заперты, второй записи не будет.
    expect(
      screen.getByRole("button", { name: "Дали: КонвулексА" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Пропустили: КонвулексА" }),
    ).toBeDisabled();
    expect(api.POST).toHaveBeenCalledTimes(2);

    act(() => answerFirst({ data: { id: "log-a" } }));
    const toastText = await screen.findByText("Отмечено: дали КонвулексА");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Дали: КонвулексА" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      within(
        (toastText.closest("li") ?? document.body) as HTMLElement,
      ).getByRole("button", { name: "Отменить" }),
    );
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith(
        "/api/v1/patients/{patient_id}/logs/medications/{log_id}",
        { params: { path: { patient_id: PATIENT_ID, log_id: "log-a" } } },
      ),
    );
  });

  it("отказ первой отметки виден, даже если следом отметили второй препарат", async () => {
    const user = userEvent.setup();
    serve([medication("m1", "КонвулексБ"), medication("m2", "ЛеветирацетамБ")]);
    let answerFirst: (value: unknown) => void = () => undefined;
    (api.POST as Mock)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ data: { id: "log-b" } });
    renderBlock();

    await user.click(
      await screen.findByRole("button", { name: "Дали: КонвулексБ" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Дали: ЛеветирацетамБ" }),
    );
    await screen.findByText("Отмечено: дали ЛеветирацетамБ");

    act(() => answerFirst({ error: { error: { code: "internal" } } }));
    // Иначе родитель счёл бы первый препарат отмеченным.
    expect(await screen.findByText("Не удалось отметить")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Дали: КонвулексБ" }),
      ).toBeEnabled(),
    );
  });

  it("две «Отменить» подряд — у каждой свой исход", async () => {
    const user = userEvent.setup();
    serve([medication("m1", "КонвулексВ"), medication("m2", "ЛеветирацетамВ")]);
    (api.POST as Mock)
      .mockResolvedValueOnce({ data: { id: "log-a" } })
      .mockResolvedValueOnce({ data: { id: "log-b" } });
    let answerFirstUndo: (value: unknown) => void = () => undefined;
    (api.DELETE as Mock)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerFirstUndo = resolve;
          }),
      )
      .mockResolvedValueOnce({});
    renderBlock();

    await user.click(
      await screen.findByRole("button", { name: "Дали: КонвулексВ" }),
    );
    const first = await screen.findByText("Отмечено: дали КонвулексВ");
    await user.click(
      screen.getByRole("button", { name: "Дали: ЛеветирацетамВ" }),
    );
    const second = await screen.findByText("Отмечено: дали ЛеветирацетамВ");
    const undoOf = (text: HTMLElement) =>
      within((text.closest("li") ?? document.body) as HTMLElement).getByRole(
        "button",
        { name: "Отменить" },
      );
    // Сообщения прошлых тестов живут в общем хранилище sonner — считаем от них.
    const undoneBefore = screen.queryAllByText("Отметка отменена").length;
    fireEvent.click(undoOf(first));
    fireEvent.click(undoOf(second));
    await waitFor(() => expect(api.DELETE).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryAllByText("Отметка отменена").length).toBe(
        undoneBefore + 1,
      ),
    );

    act(() => answerFirstUndo({ error: { error: { code: "internal" } } }));
    expect(
      await screen.findByText("Не удалось отменить отметку"),
    ).toBeInTheDocument();
  });

  it("длинная схема: первые три препарата и «Показать остальные»", async () => {
    // Пять строк схемы занимали больше экрана и уводили ближайший приём пищи
    // на два экрана вниз.
    const user = userEvent.setup();
    serve([
      medication("m1", "Депакин"),
      medication("m2", "Кеппра"),
      medication("m3", "Топамакс"),
      medication("m4", "Ламиктал"),
      medication("m5", "Сабрил"),
    ]);
    renderBlock();

    expect(await screen.findByText("Депакин")).toBeInTheDocument();
    expect(screen.getByText("Топамакс")).toBeInTheDocument();
    expect(screen.queryByText("Ламиктал")).toBeNull();
    expect(screen.queryByText("Сабрил")).toBeNull();

    const more = screen.getByRole("button", { name: "Показать остальные: 2" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(screen.getByText("Ламиктал")).toBeInTheDocument();
    expect(screen.getByText("Сабрил")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Свернуть список" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("четыре препарата видны все: прятать одну строку незачем", async () => {
    serve([
      medication("m1", "Депакин"),
      medication("m2", "Кеппра"),
      medication("m3", "Топамакс"),
      medication("m4", "Ламиктал"),
    ]);
    renderBlock();

    expect(await screen.findByText("Ламиктал")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Показать остальные/ }),
    ).toBeNull();
  });
});
