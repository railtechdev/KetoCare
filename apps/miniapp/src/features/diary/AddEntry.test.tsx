import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@ketocare/ui";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { createQueryClient } from "../../lib/queryClient";
import { OpenTabContext, type TabId } from "../../lib/tabs";
import { AddEntry } from "./AddEntry";
import { DiaryScreen } from "./DiaryScreen";
import { PATIENT_ID, SESSION, fakeGet } from "./testFixtures";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
  };
});

/*
 * Кнопка «Назад» Telegram — стопкой, как настоящая (`showBackButton`): нажатие
 * достаётся последнему подписавшемуся. Простая заглушка не проверила бы
 * главное — что нажатие закрывает верхнее состояние, а не всё сразу.
 */
const backStack = vi.hoisted(() => [] as (() => void)[]);
vi.mock("../../lib/telegram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/telegram")>();
  return {
    ...actual,
    showBackButton: (onBack: () => void) => {
      backStack.push(onBack);
      return () => {
        const index = backStack.lastIndexOf(onBack);
        if (index !== -1) backStack.splice(index, 1);
      };
    },
  };
});

function pressBack() {
  act(() => {
    backStack.at(-1)?.();
  });
}

function wrapper(openTab: (tab: TabId) => void = () => undefined) {
  // Клиент приложения: записи без сети отказывают сразу (ADR-0034), как в бою.
  const client = createQueryClient();
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { retry: false },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <OpenTabContext value={openTab}>{children}</OpenTabContext>
        <Toaster />
      </QueryClientProvider>
    );
  };
}

function renderAdd(
  options: { onClose?: () => void; openTab?: (tab: TabId) => void } = {},
) {
  const onClose = options.onClose ?? vi.fn();
  render(<AddEntry session={SESSION} onClose={onClose} />, {
    wrapper: wrapper(options.openTab),
  });
  return { onClose };
}

/** Тело и заголовки последнего POST. */
function lastPost(): {
  path: string;
  body: Record<string, unknown>;
  key: string;
} {
  const call = (api.POST as Mock).mock.calls.at(-1) as [
    string,
    {
      params: { path: unknown; header: Record<string, string> };
      body: Record<string, unknown>;
    },
  ];
  expect(call[1].params.path).toEqual({ patient_id: PATIENT_ID });
  return {
    path: call[0],
    body: call[1].body,
    key: call[1].params.header["Idempotency-Key"] ?? "",
  };
}

async function choose(user: ReturnType<typeof userEvent.setup>, kind: string) {
  await user.click(await screen.findByRole("button", { name: kind }));
}

beforeEach(() => {
  vi.clearAllMocks();
  backStack.length = 0;
  (api.GET as Mock).mockImplementation(fakeGet());
  (api.POST as Mock).mockResolvedValue({ data: {} });
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("«Добавить запись» в Mini App", () => {
  it("первичное действие вкладки открывает выбор из шести видов", async () => {
    const user = userEvent.setup();
    render(<DiaryScreen session={SESSION} />, { wrapper: wrapper() });

    await user.click(
      await screen.findByRole("button", { name: "Добавить запись" }),
    );

    expect(await screen.findByText("Что записать?")).toBeInTheDocument();
    for (const kind of [
      "Приступ",
      "Кетоны",
      "Вес",
      "Лекарство",
      "Еда",
      "Самочувствие",
    ]) {
      expect(screen.getByRole("button", { name: kind })).toBeInTheDocument();
    }
  });

  it("кетоны: POST с ключом попытки, тост и закрытие", async () => {
    const user = userEvent.setup();
    const { onClose } = renderAdd();

    await choose(user, "Кетоны");
    expect(await screen.findByText("Новая запись")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Кетоны, ммоль/л"), "1.8");
    await user.selectOptions(screen.getByLabelText("Как мерили"), "urine");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    const post = lastPost();
    expect(post.path).toBe("/api/v1/patients/{patient_id}/logs/ketones");
    expect(post.body).toEqual({
      occurred_at: expect.any(String) as string,
      value: 1.8,
      method: "urine",
    });
    expect(post.key).toMatch(/^[\x21\x23-\x5b\x5d-\x7e]{1,255}$/);
    expect(await screen.findByText("Запись добавлена")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("вес: граница из кита не пускает запись на сервер", async () => {
    const user = userEvent.setup();
    renderAdd();

    await choose(user, "Вес");
    await user.type(await screen.findByLabelText("Вес, кг"), "200");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Число от 2 до 150.")).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Вес, кг"));
    await user.type(screen.getByLabelText("Вес, кг"), "18.6");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    expect(lastPost()).toMatchObject({
      path: "/api/v1/patients/{patient_id}/logs/weight",
      body: { weight_kg: 18.6, height_cm: null },
    });
  });

  it("приступ: тип обязателен, интервал со слов уходит ссылкой, а не секундами", async () => {
    const user = userEvent.setup();
    renderAdd();

    await choose(user, "Приступ");
    // Тип не подставлен: запись ушла бы с приступом, которого не выбирали.
    const type = await screen.findByLabelText("Какой приступ");
    expect(type).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Далее" }));
    expect(
      await screen.findByText("Выберите, какой был приступ."),
    ).toBeInTheDocument();

    await user.selectOptions(type, "t1");
    await user.selectOptions(screen.getByLabelText(/^Примерно/), "d1");
    await user.click(screen.getByRole("button", { name: "Далее" }));
    expect(await screen.findByLabelText("Сколько раз")).toHaveValue(1);
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    expect(lastPost()).toMatchObject({
      path: "/api/v1/patients/{patient_id}/logs/seizures",
      body: {
        seizure_type_id: "t1",
        duration_option_id: "d1",
        duration_sec: null,
        count: 1,
        description: null,
        triggers: null,
      },
    });
  });

  it("лекарство: из схемы врача, «пропустили» выбирается явно", async () => {
    const user = userEvent.setup();
    renderAdd();

    await choose(user, "Лекарство");
    const drug = await screen.findByLabelText("Лекарство");
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Депакин" }),
      ).toBeInTheDocument(),
    );
    await user.selectOptions(drug, "m1");
    // Как в боте, по умолчанию — «дали».
    expect(screen.getByRole("radio", { name: "Дали" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Пропустили" }));
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    expect(lastPost()).toMatchObject({
      path: "/api/v1/patients/{patient_id}/logs/medications",
      body: { medication_id: "m1", taken: false },
    });
  });

  it("лекарство недоступно, пока врач не внёс схему", async () => {
    const base = fakeGet();
    (api.GET as Mock).mockImplementation((path: string) =>
      path.endsWith("/medications")
        ? Promise.resolve({ data: { items: [], total: 0 } })
        : base(path),
    );
    renderAdd();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Лекарство" })).toBeDisabled(),
    );
    expect(
      screen.getByText("Врач ещё не внёс препараты — отмечать пока нечего."),
    ).toBeInTheDocument();
  });

  it("самочувствие", async () => {
    const user = userEvent.setup();
    renderAdd();

    await choose(user, "Самочувствие");
    await user.type(await screen.findByLabelText("Что беспокоит"), "вялость");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    expect(lastPost()).toMatchObject({
      path: "/api/v1/patients/{patient_id}/logs/side-effects",
      body: { symptom: "вялость", description: null },
    });
  });

  it("еда — не свободный текст, а план дня", async () => {
    // Выдуманное блюдо вошло бы в итоги дня наравне с настоящим.
    const user = userEvent.setup();
    const openTab = vi.fn();
    const { onClose } = renderAdd({ openTab });

    await choose(user, "Еда");
    expect(await screen.findByText("Еда — в плане дня")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Открыть план дня" }));

    expect(openTab).toHaveBeenCalledWith("menu");
    expect(onClose).toHaveBeenCalled();
    expect(api.POST).not.toHaveBeenCalled();
  });

  it("повтор после потерянного ответа уходит с тем же ключом", async () => {
    // Ответ не дошёл, запись могла лечь на сервер. Второе нажатие обязано
    // уйти с тем же ключом — сервер вернёт прежний ответ, а не второй замер
    // (ADR-0035). Правка значения — уже другая запись и другой ключ.
    (api.POST as Mock)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderAdd();

    await choose(user, "Кетоны");
    await user.type(await screen.findByLabelText("Кетоны, ммоль/л"), "2.1");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(
      await screen.findByText("Не удалось сохранить запись"),
    ).toBeInTheDocument();
    const first = lastPost().key;

    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
    expect(lastPost().key).toBe(first);
  });

  it("правка значения после отказа даёт новый ключ", async () => {
    (api.POST as Mock).mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    renderAdd();

    await choose(user, "Кетоны");
    const value = await screen.findByLabelText("Кетоны, ммоль/л");
    await user.type(value, "2.1");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    const first = lastPost().key;

    await user.clear(value);
    await user.type(value, "2.2");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
    expect(lastPost().key).not.toBe(first);
  });

  it("отказ сервера показывается его словами", async () => {
    (api.POST as Mock).mockResolvedValue({
      error: {
        error: {
          code: "conflict",
          message: "Такая запись уже отправляется — подождите немного.",
          details: null,
        },
      },
    });
    const user = userEvent.setup();
    renderAdd();

    await choose(user, "Кетоны");
    await user.type(await screen.findByLabelText("Кетоны, ммоль/л"), "2.1");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(
      await screen.findByText(
        "Такая запись уже отправляется — подождите немного.",
      ),
    ).toBeInTheDocument();
  });

  it("без сети сохранить нельзя, и это сказано заранее", async () => {
    const user = userEvent.setup();
    renderAdd();

    await choose(user, "Кетоны");
    await user.type(await screen.findByLabelText("Кетоны, ммоль/л"), "2.1");
    act(() => {
      onlineManager.setOnline(false);
    });

    expect(
      await screen.findByText("Нет связи с сервером. Проверьте подключение."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    await user.type(screen.getByLabelText("Кетоны, ммоль/л"), "{Enter}");
    expect(api.POST).not.toHaveBeenCalled();
  });

  it("«Назад» Telegram: из формы — к выбору вида, из выбора — закрыть", async () => {
    const user = userEvent.setup();
    const { onClose } = renderAdd();

    await choose(user, "Вес");
    await screen.findByLabelText("Вес, кг");
    pressBack();

    expect(await screen.findByText("Что записать?")).toBeInTheDocument();
    expect(screen.queryByLabelText("Вес, кг")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    pressBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("«Назад» из пояснения про еду возвращает к выбору", async () => {
    const user = userEvent.setup();
    const { onClose } = renderAdd();

    await choose(user, "Еда");
    await screen.findByText("Еда — в плане дня");
    pressBack();

    expect(await screen.findByText("Что записать?")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
