import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import i18n from "../../lib/i18n";
import { api } from "../../lib/api";
import doctorRu from "../../locales/ru/doctor.json";
import { MedicationsTab } from "./MedicationsTab";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  };
});

vi.mock("../auth/useSession", () => ({
  useSession: () => ({ session: { userId: "d1", role: "doctor" } }),
}));

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
const DRUG_ID = "22222222-2222-4222-8222-222222222222";

let medications: unknown[] = [];
/** Семья выбрала в анкете вариант «Не знаю названия» — он там законный. */
let notDrugInIntake = false;
const NOT_DRUG_ID = "33333333-3333-4333-8333-333333333333";

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<MedicationsTab patientId={PATIENT_ID} />, {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  medications = [];
  notDrugInIntake = false;
  (api.GET as Mock).mockImplementation((path: string) => {
    if (path.includes("/medications")) {
      return Promise.resolve({
        data: { items: medications, total: medications.length },
      });
    }
    if (path.includes("aed-drugs")) {
      return Promise.resolve({
        data: {
          items: [
            {
              id: DRUG_ID,
              name_ru: "Вальпроат натрия",
              synonyms: ["Депакин"],
              is_drug: true,
              sort: 0,
              retired: false,
            },
            {
              id: NOT_DRUG_ID,
              name_ru: "Не знаю названия",
              synonyms: ["не знаю"],
              is_drug: false,
              sort: 1,
              retired: false,
            },
          ],
        },
      });
    }
    if (path.includes("/intake")) {
      return Promise.resolve({
        data: {
          current_aed_ids: notDrugInIntake ? [DRUG_ID, NOT_DRUG_ID] : [DRUG_ID],
        },
      });
    }
    return Promise.resolve({ data: { items: [], total: 0 } });
  });
});

describe("препараты из анкеты семьи", () => {
  it("предлагает перенести в схему то, что назвала семья", async () => {
    // Семья перечислила ПЭП при регистрации, схему пишет врач — связи между
    // анкетой и `medications` не было никакой.
    renderTab();

    expect(
      await screen.findByRole("button", { name: /Вальпроат натрия/ }),
    ).toBeInTheDocument();
  });

  it("подставляет название в форму, но не заводит препарат сам", async () => {
    // Назначение препарата — врачебное решение: доза и режим приёма в анкете
    // не названы и взяться им неоткуда.
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole("button", { name: /Вальпроат натрия/ }),
    );

    expect(
      await screen.findByDisplayValue("Вальпроат натрия"),
    ).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();
  });

  it("выбранное в подсказке название доходит до сервера", async () => {
    // Стык, ради которого правка и делалась: врач набирает синоним, выбирает
    // каноническое название — и в `drug_name` уходит именно оно. Ни тест поля,
    // ни тест вкладки по отдельности этого пути не закрывают.
    (api.POST as Mock).mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole("button", { name: "Назначить препарат" }),
    );

    const drug = await screen.findByLabelText("Препарат");
    await user.clear(drug);
    await user.type(drug, "депакин");
    await user.click(
      await screen.findByRole("option", { name: /Вальпроат натрия/ }),
    );

    await user.type(screen.getByLabelText(/Разовая доза/), "300");
    await user.selectOptions(screen.getByLabelText(/Единица дозы/), "мг");
    await user.selectOptions(
      screen.getByLabelText("Кратность"),
      "2 раза в сутки",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.POST).toHaveBeenCalled());
    const body = (api.POST as Mock).mock.calls[0]?.[1]?.body;
    expect(body).toMatchObject({
      drug_name: "Вальпроат натрия",
      dose_value: 300,
      dose_unit: "mg",
      dose_text: null,
      frequency_code: "twice_daily",
      // Пустое уточнение уходит как «уточнения нет».
      frequency: null,
    });
  });

  it("не предлагает завести «Не знаю названия» как препарат", async () => {
    // Семья могла выбрать в анкете именно этот вариант — он там законный. Но
    // это не лекарство, и в схему лечения ему нельзя.
    //
    // В анкете названы ОБА: настоящий препарат служит якорем. Ждать «кнопку
    // добавления» было мало — она рисуется до того, как придут анкета и
    // справочник, и проверка проходила бы, ничего не проверяя.
    notDrugInIntake = true;
    renderTab();

    await screen.findByRole("button", { name: /Вальпроат натрия/ });
    expect(
      screen.queryByRole("button", { name: /Не знаю названия/ }),
    ).not.toBeInTheDocument();
  });

  it("после неудачной отправки сводка ошибок ведёт первой строкой в первое незаполненное поле", async () => {
    // react-hook-form обходит поля в порядке РЕГИСТРАЦИИ, а поле препарата
    // идёт через `Controller` и регистрируется позже соседей: на пустой форме
    // первой называлась доза, и человек с клавиатуры узнавал не о той ошибке.
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole("button", { name: "Назначить препарат" }),
    );
    await user.click(await screen.findByRole("button", { name: "Сохранить" }));

    const summary = await screen.findByRole("alert");
    await waitFor(() => expect(summary).toHaveFocus());
    await user.click(within(summary).getAllByRole("link")[0]!);
    expect(screen.getByLabelText("Препарат")).toHaveFocus();
  });

  it("панель препарата: «Закрыть» по-русски, фокус на первом поле", async () => {
    // Ключ подписи идёт из словаря экрана: опечатка в нём дала бы кнопку без
    // имени, и ни один тест кита этого не увидел бы.
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole("button", { name: "Назначить препарат" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Закрыть" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Препарат")).toHaveFocus(),
    );
  });

  it("не предлагает то, что уже есть в схеме", async () => {
    medications = [
      {
        id: "m1",
        patient_id: PATIENT_ID,
        drug_name: "Вальпроат натрия",
        dose: "300 мг",
        frequency: "2 раза в день",
        started_at: "2026-08-01",
        stopped_at: null,
      },
    ];

    renderTab();

    await screen.findByText("300 мг");
    expect(
      screen.queryByRole("button", { name: /^Вальпроат натрия$/ }),
    ).not.toBeInTheDocument();
  });
});

describe("кратность приёма из списка", () => {
  it("«Другая схема» без слов не отправляется, ошибка у поля уточнения", async () => {
    // Сервер отказал бы общей строкой; врач узнаёт, чего не хватает, у поля.
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole("button", { name: "Назначить препарат" }),
    );
    await user.type(await screen.findByLabelText("Препарат"), "Вальпроат");
    await user.type(screen.getByLabelText(/Разовая доза/), "300");
    await user.selectOptions(screen.getByLabelText(/Единица дозы/), "мг");
    await user.selectOptions(
      screen.getByLabelText("Кратность"),
      "Другая схема",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    const summary = await screen.findByRole("alert");
    await user.click(
      within(summary).getByRole("link", {
        name: "Для «Другой схемы» опишите кратность словами.",
      }),
    );
    expect(screen.getByLabelText(/Уточнение к кратности/)).toHaveFocus();
    expect(api.POST).not.toHaveBeenCalled();
  });

  it("в таблице кратность словами: подпись с уточнением и слова старой записи", async () => {
    medications = [
      {
        id: "m1",
        patient_id: PATIENT_ID,
        drug_name: "Леветирацетам",
        dose: "250 мг",
        frequency_code: "twice_daily",
        frequency: "утром и на ночь",
        started_at: "2026-08-01",
        stopped_at: null,
      },
      {
        id: "m2",
        patient_id: PATIENT_ID,
        drug_name: "Топирамат",
        dose: "25 мг",
        dose_value: 25,
        dose_unit: "mg",
        frequency_code: null,
        frequency: "на ночь",
        started_at: "2026-08-01",
        stopped_at: null,
      },
    ];
    renderTab();

    expect(
      await screen.findByText("2 раза в сутки — утром и на ночь"),
    ).toBeInTheDocument();
    expect(screen.getByText("на ночь")).toBeInTheDocument();
    // Код врачу не показывается никогда.
    expect(screen.queryByText("twice_daily")).not.toBeInTheDocument();
  });

  it("правка старой записи просит выбрать код и не подставляет его молча", async () => {
    // Кратность такой записи — слова. Угадывать по ним код нельзя: форма
    // переносит слова в уточнение, оставляет список пустым и без выбора не
    // отправляет.
    medications = [
      {
        id: "m3",
        patient_id: PATIENT_ID,
        drug_name: "Топирамат",
        dose: "25 мг",
        dose_value: 25,
        dose_unit: "mg",
        frequency_code: null,
        frequency: "3 раза в день",
        started_at: "2026-08-01",
        stopped_at: null,
      },
    ];
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole("button", {
        name: "Изменить назначение препарата Топирамат",
      }),
    );

    expect(
      await screen.findByText(doctorRu.medications.frequencyLegacyHint),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Кратность")).toHaveValue("");
    expect(screen.getByLabelText(/Уточнение к кратности/)).toHaveValue(
      "3 раза в день",
    );

    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    // Под полем и строкой в сводке ошибок (правило П8).
    expect(
      await screen.findAllByText("Выберите кратность из списка."),
    ).toHaveLength(2);
    expect(api.PUT).not.toHaveBeenCalled();
  });

  it("правка старой записи: выбранный код и прежние слова уходят вместе", async () => {
    // Слова переносит в уточнение кабинет, а не сервер: потеря их при отправке
    // стёрла бы кратность, которую врач однажды записал.
    medications = [
      {
        id: "m3",
        patient_id: PATIENT_ID,
        drug_name: "Топирамат",
        dose: "25 мг",
        dose_value: 25,
        dose_unit: "mg",
        frequency_code: null,
        frequency: "на ночь",
        started_at: "2026-08-01",
        stopped_at: null,
      },
    ];
    (api.PUT as Mock).mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole("button", {
        name: "Изменить назначение препарата Топирамат",
      }),
    );
    await user.selectOptions(
      await screen.findByLabelText("Кратность"),
      "1 раз в сутки",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.PUT).toHaveBeenCalled());
    const body = (api.PUT as Mock).mock.calls[0]?.[1]?.body;
    expect(body).toMatchObject({
      frequency_code: "once_daily",
      frequency: "на ночь",
    });
  });
});

describe("доза числом и единицей", () => {
  it("отказ прошлой попытки не встаёт под новой формой", async () => {
    (api.POST as Mock).mockResolvedValue({
      error: {
        error: { code: "conflict", message: "Такой препарат уже в схеме." },
      },
    });
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole("button", { name: "Назначить препарат" }),
    );
    await user.type(await screen.findByLabelText("Препарат"), "Вальпроат");
    await user.type(screen.getByLabelText(/Разовая доза/), "250");
    await user.selectOptions(screen.getByLabelText(/Единица дозы/), "мг");
    await user.selectOptions(
      screen.getByLabelText("Кратность"),
      "2 раза в сутки",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(
      await screen.findByText("Такой препарат уже в схеме."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Отмена" }));
    const [open] = await screen.findAllByRole("button", {
      name: "Назначить препарат",
    });
    await user.click(open!);

    expect(await screen.findByLabelText("Препарат")).toBeInTheDocument();
    expect(screen.queryByText("Такой препарат уже в схеме.")).toBeNull();
  });

  it("«2,5» с запятой и «мл» уходят числом и кодом единицы", async () => {
    (api.POST as Mock).mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole("button", { name: "Назначить препарат" }),
    );
    await user.type(await screen.findByLabelText("Препарат"), "Вальпроат");
    await user.type(screen.getByLabelText(/Разовая доза/), "2,5");
    await user.selectOptions(screen.getByLabelText(/Единица дозы/), "мл");
    await user.selectOptions(
      screen.getByLabelText("Кратность"),
      "2 раза в сутки",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.POST).toHaveBeenCalled());
    expect((api.POST as Mock).mock.calls[0]?.[1]?.body).toMatchObject({
      dose_value: 2.5,
      dose_unit: "ml",
      dose_text: null,
    });
  });

  it("строка вместо числа не отправляется, ошибка у поля дозы", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole("button", { name: "Назначить препарат" }),
    );
    await user.type(await screen.findByLabelText("Препарат"), "Вальпроат");
    await user.type(screen.getByLabelText(/Разовая доза/), "300 мг");
    await user.selectOptions(screen.getByLabelText(/Единица дозы/), "мг");
    await user.selectOptions(
      screen.getByLabelText("Кратность"),
      "2 раза в сутки",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    const summary = await screen.findByRole("alert");
    await user.click(
      within(summary).getByRole("link", {
        name: doctorRu.medications.errors.doseValue,
      }),
    );
    expect(screen.getByLabelText(/Разовая доза/)).toHaveFocus();
    expect(api.POST).not.toHaveBeenCalled();
  });

  it("«другая единица» — доза словами вместо числа", async () => {
    (api.POST as Mock).mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole("button", { name: "Назначить препарат" }),
    );
    await user.type(await screen.findByLabelText("Препарат"), "Вальпроат");
    await user.selectOptions(
      screen.getByLabelText(/Единица дозы/),
      "другая единица",
    );
    expect(screen.queryByLabelText(/Разовая доза/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Доза словами/), "30 мг/кг/сут");
    await user.selectOptions(
      screen.getByLabelText("Кратность"),
      "2 раза в сутки",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.POST).toHaveBeenCalled());
    expect((api.POST as Mock).mock.calls[0]?.[1]?.body).toMatchObject({
      dose_value: null,
      dose_unit: "other",
      dose_text: "30 мг/кг/сут",
    });
  });

  it("правка записи со строкой дозы: строка в подсказке, единицу выбирает врач", async () => {
    // Строку «по 1/2 таб. на ночь» в число не переводим: это решение врача.
    medications = [
      {
        id: "m4",
        patient_id: PATIENT_ID,
        drug_name: "Топирамат",
        dose: "по 1/2 таб. на ночь",
        dose_value: null,
        dose_unit: null,
        frequency_code: "once_daily",
        frequency: null,
        started_at: "2026-08-01",
        stopped_at: null,
      },
    ];
    const user = userEvent.setup();
    renderTab();

    // В таблице строка — как была.
    expect(await screen.findByText("по 1/2 таб. на ночь")).toBeInTheDocument();

    await user.click(
      await screen.findByRole("button", {
        name: "Изменить назначение препарата Топирамат",
      }),
    );

    expect(
      await screen.findByText(/Раньше доза записывалась строкой/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Единица дозы/)).toHaveValue("");
    expect(screen.getByLabelText(/Разовая доза/)).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    // Под полем и строкой в сводке ошибок (правило П8).
    expect(
      await screen.findAllByText(doctorRu.medications.errors.doseUnit),
    ).toHaveLength(2);
    expect(api.PUT).not.toHaveBeenCalled();
  });
});
