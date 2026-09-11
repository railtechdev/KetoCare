import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

    await user.type(screen.getByLabelText(/Принимаемая доза/), "300 мг");
    await user.selectOptions(
      screen.getByLabelText("Кратность"),
      "2 раза в сутки",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.POST).toHaveBeenCalled());
    const body = (api.POST as Mock).mock.calls[0]?.[1]?.body;
    expect(body).toMatchObject({
      drug_name: "Вальпроат натрия",
      dose: "300 мг",
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

  it("после неудачной отправки фокус встаёт на первое незаполненное поле", async () => {
    // react-hook-form обходит поля в порядке РЕГИСТРАЦИИ, а поле препарата
    // идёт через `Controller` и регистрируется позже соседей: на пустой форме
    // фокус вставал на дозу, и человек с клавиатуры узнавал не о той ошибке.
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole("button", { name: "Назначить препарат" }),
    );
    await user.click(await screen.findByRole("button", { name: "Сохранить" }));

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
    await user.type(screen.getByLabelText(/Принимаемая доза/), "300 мг");
    await user.selectOptions(
      screen.getByLabelText("Кратность"),
      "Другая схема",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(
      await screen.findByText("Для «Другой схемы» опишите кратность словами."),
    ).toBeInTheDocument();
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
});
