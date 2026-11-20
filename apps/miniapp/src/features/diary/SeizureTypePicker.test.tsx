import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Toaster } from "@ketocare/ui";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import "../../lib/i18n";
import { api } from "../../lib/api";
import { AddEntry } from "./AddEntry";
import { DiaryEntries } from "./DiaryEntries";
import {
  SESSION,
  defaultLogs,
  fakeGet,
  type SeizureFixture,
} from "./testFixtures";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
  };
});

/* «Назад» Telegram — стопкой, как настоящая (см. `AddEntry.test.tsx`). */
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

/*
 * Справочник ILAE 2025 — те же узлы, что в тестах бота и кита
 * (`apps/bot/tests/test_seizure.py`, `packages/ui/src/lib/seizureTree.test.ts`).
 */
const ILAE: [string, string][] = [
  ["1", "Фокальный приступ"],
  ["1.1", "Фокальный приступ с сохранением сознания"],
  ["1.2", "Фокальный приступ с нарушением сознания"],
  ["3", "Генерализованный приступ"],
  ["3.1", "Абсанс"],
  ["3.1.1", "Типичный абсанс"],
  ["3.2", "Генерализованный тонико-клонический приступ"],
  ["3.3.1", "Генерализованный миоклонический приступ"],
  ["4", "Неклассифицированный приступ"],
];
const TYPES = [
  ...ILAE.map(([ref, name]) => ({
    id: `id-${ref}`,
    name_ru: name,
    ilae_ref: ref,
  })),
  // Выведенный тип до ILAE 2025 (ADR-0050): новой записью не выбирается.
  { id: "old", name_ru: "Старый тип", ilae_ref: null, retired: true },
];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}

function renderNew(seizures: SeizureFixture = { types: TYPES }) {
  (api.GET as Mock).mockImplementation(fakeGet(defaultLogs(), seizures));
  const onClose = vi.fn();
  render(
    <AddEntry session={SESSION} initialKind="seizures" onClose={onClose} />,
    { wrapper },
  );
  return { onClose };
}

function lastPostBody(): Record<string, unknown> {
  const call = (api.POST as Mock).mock.calls.at(-1) as [
    string,
    { body: Record<string, unknown> },
  ];
  return call[1].body;
}

async function finish(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Далее" }));
  await user.click(await screen.findByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.clearAllMocks();
  backStack.length = 0;
  (api.POST as Mock).mockResolvedValue({ data: { id: "new" } });
  (api.PATCH as Mock).mockResolvedValue({ data: {} });
});

describe("выбор типа приступа в Mini App (Д3)", () => {
  it("первым — типы прошлых приступов ребёнка, «Другой тип» и «Не знаю»", async () => {
    const user = userEvent.setup();
    renderNew({
      types: TYPES,
      recent: ["id-3.2", "id-1.1", "чужой-или-выведенный"],
    });

    await screen.findByRole("button", { name: "Другой тип" });
    expect(screen.getByText("Какой был приступ?")).toBeInTheDocument();
    const buttons = (await screen.findAllByRole("button"))
      .map((button) => button.textContent)
      // Кроме «Назад» формы и значка закрытия панели (у него нет текста).
      .filter((text) => text !== "Назад" && text !== "");
    expect(buttons).toEqual([
      "Генерализованный тонико-клонический приступ",
      "Фокальный приступ с сохранением сознания",
      "Другой тип",
      "Не знаю",
    ]);

    await user.click(
      screen.getByRole("button", {
        name: "Фокальный приступ с сохранением сознания",
      }),
    );
    expect(
      await screen.findByText("Фокальный приступ с сохранением сознания"),
    ).toBeInTheDocument();
    await finish(user);
    expect(lastPostBody()).toMatchObject({ seizure_type_id: "id-1.1" });
  });

  it("«Другой тип» → группа → подтип", async () => {
    const user = userEvent.setup();
    renderNew({ types: TYPES, recent: ["id-3.2"] });

    await user.click(await screen.findByRole("button", { name: "Другой тип" }));
    expect(
      await screen.findByText("Какой был приступ? Выберите группу."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Фокальный приступ" }),
    ).toBeInTheDocument();
    // «Неклассифицированный» — это и есть «Не знаю»; подтипы — на шаг ниже.
    expect(
      screen.queryByRole("button", { name: "Неклассифицированный приступ" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Не знаю" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Абсанс" })).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Генерализованный приступ" }),
    );
    expect(
      await screen.findByText("Генерализованный приступ: какой именно?"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Генерализованный приступ, точнее не знаю",
      }),
    ).toBeInTheDocument();
    // Ближайший существующий предок «3.3.1» — «3»: он здесь, а не потерян.
    expect(
      screen.getByRole("button", {
        name: "Генерализованный миоклонический приступ",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Типичный абсанс" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Абсанс" }));
    await user.click(
      await screen.findByRole("button", { name: "Типичный абсанс" }),
    );
    expect(await screen.findByText("Типичный абсанс")).toBeInTheDocument();
    await finish(user);
    expect(lastPostBody()).toMatchObject({ seizure_type_id: "id-3.1.1" });
  });

  it("группу можно выбрать саму — «точнее не знаю»", async () => {
    const user = userEvent.setup();
    renderNew();

    await user.click(
      await screen.findByRole("button", { name: "Фокальный приступ" }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Фокальный приступ, точнее не знаю",
      }),
    );
    await finish(user);
    expect(lastPostBody()).toMatchObject({ seizure_type_id: "id-1" });
  });

  it("«Не знаю» — узел «Неклассифицированный приступ» справочника", async () => {
    const user = userEvent.setup();
    renderNew({ types: TYPES, recent: ["id-1.1"] });

    await user.click(await screen.findByRole("button", { name: "Не знаю" }));
    expect(
      await screen.findByText("Неклассифицированный приступ"),
    ).toBeInTheDocument();
    await finish(user);
    expect(lastPostBody()).toMatchObject({ seizure_type_id: "id-4" });
  });

  it("«Назад» Telegram поднимается на уровень, а с первого — закрывает", async () => {
    const user = userEvent.setup();
    const { onClose } = renderNew({ types: TYPES, recent: ["id-3.2"] });

    await user.click(await screen.findByRole("button", { name: "Другой тип" }));
    await user.click(
      await screen.findByRole("button", { name: "Генерализованный приступ" }),
    );
    await user.click(await screen.findByRole("button", { name: "Абсанс" }));
    expect(
      await screen.findByText("Абсанс: какой именно?"),
    ).toBeInTheDocument();

    pressBack();
    expect(
      await screen.findByText("Генерализованный приступ: какой именно?"),
    ).toBeInTheDocument();
    pressBack();
    expect(
      await screen.findByText("Какой был приступ? Выберите группу."),
    ).toBeInTheDocument();
    pressBack();
    expect(
      await screen.findByRole("button", { name: "Другой тип" }),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // Форма без типа не открывается: с первого уровня — туда, откуда пришли.
    pressBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("без истории ребёнка выбор начинается с групп", async () => {
    renderNew({ types: TYPES, recent: [] });

    expect(
      await screen.findByText("Какой был приступ? Выберите группу."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Другой тип" })).toBeNull();
  });

  it("справочник без номеров ILAE — одним списком", async () => {
    const user = userEvent.setup();
    renderNew({
      types: [
        { id: "a", name_ru: "Тонико-клонический" },
        { id: "b", name_ru: "Абсанс" },
      ],
    });

    expect(
      await screen.findByRole("button", { name: "Абсанс" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Какой был приступ?")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Тонико-клонический" }),
    );
    await finish(user);
    expect(lastPostBody()).toMatchObject({ seizure_type_id: "a" });
  });

  it("выведенный тип не предлагается, но запись на нём его называет", async () => {
    const user = userEvent.setup();
    const logs = defaultLogs();
    logs.seizures = [
      { ...(logs.seizures?.[0] as object), seizure_type_id: "old" },
    ];
    (api.GET as Mock).mockImplementation(
      fakeGet(logs, { types: TYPES, recent: ["old", "id-3.2"] }),
    );
    render(<DiaryEntries session={SESSION} onAdd={() => undefined} />, {
      wrapper,
    });

    await user.click(
      await screen.findByRole("button", {
        name: "Изменить запись «Приступ: Старый тип»",
      }),
    );
    // Тип записи назван по-прежнему — правка не переписывает его молча.
    expect(await screen.findByText("Старый тип")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Изменить тип" }));
    expect(await screen.findByText("Какой был приступ?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Старый тип" })).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Генерализованный тонико-клонический приступ",
      }),
    ).toBeInTheDocument();

    // «Назад» с выбора у правки — к форме, а не закрыть её.
    pressBack();
    expect(
      await screen.findByRole("button", { name: "Изменить тип" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Старый тип")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Изменить тип" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Генерализованный тонико-клонический приступ",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Далее" }));
    await user.click(await screen.findByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.PATCH).toHaveBeenCalledTimes(1));
    expect(api.PATCH).toHaveBeenCalledWith(
      "/api/v1/patients/{patient_id}/logs/seizures/{log_id}",
      expect.objectContaining({
        body: expect.objectContaining({ seizure_type_id: "id-3.2" }) as object,
      }),
    );
  });
});

describe("выбор типа приступа ждёт ответов, а не перерисовывается под пальцем", () => {
  /** `api.GET`, у которого прошлые типы отвечают, когда скажет тест. */
  function withLateRecent(recent: string[]) {
    const base = fakeGet(defaultLogs(), { types: TYPES, recent });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    (api.GET as Mock).mockImplementation((path: string) =>
      path.endsWith("/seizures/recent-types")
        ? gate.then((): Promise<unknown> => base(path))
        : base(path),
    );
    return () => act(() => release());
  }

  it("справочник пришёл раньше прошлых типов — групп нет, пока их ждём", async () => {
    const release = withLateRecent(["id-3.2"]);
    render(
      <AddEntry session={SESSION} initialKind="seizures" onClose={vi.fn()} />,
      {
        wrapper,
      },
    );

    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        "/api/v1/dictionaries/seizure-types",
        expect.anything(),
      ),
    );
    // Справочник уже здесь, прошлых типов ещё нет: экран ждёт, а не рисует
    // группы, которые через миг сменились бы прошлыми типами.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByRole("status")).toHaveTextContent("Загружаем…");
    expect(
      screen.queryByRole("button", { name: "Фокальный приступ" }),
    ).toBeNull();

    await release();
    expect(
      await screen.findByRole("button", {
        name: "Генерализованный тонико-клонический приступ",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Другой тип" }),
    ).toBeInTheDocument();
  });

  it("первый экран после показа не меняется от нового ответа", async () => {
    // Отказ прошлых типов — выбор начинается с групп; пришедший потом ответ
    // (повтор, обновление) первый экран уже не переставляет.
    const base = fakeGet(defaultLogs(), { types: TYPES, recent: ["id-3.2"] });
    let recentCalls = 0;
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path.endsWith("/seizures/recent-types")) {
        recentCalls += 1;
        return recentCalls === 1
          ? Promise.resolve({ error: { error: { code: "internal" } } })
          : base(path);
      }
      return base(path);
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <AddEntry session={SESSION} initialKind="seizures" onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "Фокальный приступ" }),
    ).toBeInTheDocument();
    await act(() => client.refetchQueries());
    await waitFor(() => expect(recentCalls).toBe(2));
    expect(
      screen.getByRole("button", { name: "Фокальный приступ" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Другой тип" })).toBeNull();
  });

  it("отказ справочника — сообщение с «Повторить», а не вечная загрузка", async () => {
    const user = userEvent.setup();
    const base = fakeGet(defaultLogs(), { types: TYPES, recent: [] });
    let dictionaryCalls = 0;
    (api.GET as Mock).mockImplementation((path: string) => {
      if (path.endsWith("/seizure-types")) {
        dictionaryCalls += 1;
        if (dictionaryCalls === 1) {
          return Promise.resolve({
            error: {
              error: { code: "internal", message: "Сервер недоступен" },
            },
          });
        }
      }
      return base(path);
    });
    render(
      <AddEntry session={SESSION} initialKind="seizures" onClose={vi.fn()} />,
      {
        wrapper,
      },
    );

    expect(
      await screen.findByText("Не удалось загрузить список типов приступов"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Загружаем…")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(
      await screen.findByRole("button", { name: "Фокальный приступ" }),
    ).toBeInTheDocument();
  });

  it("без сети справочник ждёт связи — так и сказано", async () => {
    (api.GET as Mock).mockImplementation(
      fakeGet(defaultLogs(), { types: TYPES }),
    );
    onlineManager.setOnline(false);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    try {
      render(
        <QueryClientProvider client={client}>
          <AddEntry
            session={SESSION}
            initialKind="seizures"
            onClose={vi.fn()}
          />
        </QueryClientProvider>,
      );
      expect(
        await screen.findByText(
          "Нет связи — покажем, как только она появится.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText("Загружаем…")).toBeNull();
    } finally {
      client.clear();
      onlineManager.setOnline(true);
    }
  });
});
