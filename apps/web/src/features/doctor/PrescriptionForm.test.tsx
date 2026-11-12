import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import "../../lib/i18n";
import { PrescriptionForm } from "./PrescriptionForm";
import { nativeSelect, valueControl } from "../../test/nativeSelect";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { POST: vi.fn() } };
});

const GOAL = {
  day: { fat_g: 120, protein_g: 24, net_carbs_g: 10.3, non_fat_g: 34.3 },
  meal: { fat_g: 30, protein_g: 6, net_carbs_g: 2.6, non_fat_g: 8.6 },
  dietary_unit_kcal: 35.5,
  engine_version: "1.7.0",
};

beforeEach(() => {
  (api.POST as Mock).mockReset();
  (api.POST as Mock).mockResolvedValue({ data: GOAL });
});

function renderForm(
  onSubmit = vi.fn(),
  { ratio }: { ratio?: number } = { ratio: 3.5 },
) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PrescriptionForm
        defaultValues={{
          ratio,
          kcalPerDay: 1200,
          proteinG: 24,
          carbsLimitG: 10,
          mealsPerDay: 4,
          effectiveFrom: "2026-09-09",
        }}
        pending={false}
        error={null}
        onSubmit={onSubmit}
      />
    </QueryClientProvider>,
  );
  return onSubmit;
}

describe("предпросмотр назначения в граммах", () => {
  it("показывает граммы от сервера на сутки и на приём", async () => {
    renderForm();

    expect(
      await screen.findByText("Что это даёт в граммах"),
    ).toBeInTheDocument();
    const fat = screen.getByRole("row", { name: /Жир/ });
    expect(fat).toHaveTextContent("120");
    expect(fat).toHaveTextContent("30");
    expect(api.POST).toHaveBeenCalledWith("/api/v1/calc/prescription-goal", {
      body: {
        ratio: 3.5,
        kcal_per_day: 1200,
        protein_g: 24,
        meals_per_day: 4,
      },
    });
  });

  it("называет белок, который не помещается в назначение", async () => {
    (api.POST as Mock).mockResolvedValue({
      data: {
        ...GOAL,
        day: { ...GOAL.day, protein_g: null, net_carbs_g: null },
        meal: { ...GOAL.meal, protein_g: null, net_carbs_g: null },
      },
    });
    renderForm();

    expect(
      await screen.findByText(/Белка больше, чем позволяют/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /^Белок \d/ })).toBeNull();
  });

  it("показывает арифметику диетической единицы", async () => {
    renderForm();

    expect(
      await screen.findByText(
        /Диетическая единица при 3\.5 : 1: 3,5 г жира и 1 г белка с углеводами, 35,5 ккал/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/= 34,3 единицы в сутки/)).toBeInTheDocument();
  });

  it("не спрашивает сервер, пока соотношение не выбрано", () => {
    renderForm(vi.fn(), { ratio: undefined });

    expect(api.POST).not.toHaveBeenCalled();
  });
});

describe("кетосоотношение в назначении", () => {
  it("выбирается из списка и подписано как соотношение", async () => {
    // Врач мыслит «4 : 1», а поле показывало «4»: это класс ошибок, а не
    // косметика. Пометка заказчицы на снимке формы — «4:1 3:1».
    renderForm();

    const field = screen.getByLabelText(/Кетосоотношение/);
    expect(field).toHaveAttribute("role", "combobox");
    expect(
      within(nativeSelect(field)).getByRole("option", {
        hidden: true,
        name: "4.0 : 1",
      }),
    ).toBeInTheDocument();
    expect(
      within(nativeSelect(field)).getByRole("option", {
        hidden: true,
        name: "3.5 : 1",
      }),
    ).toBeInTheDocument();
  });

  it("предлагает ровно те значения, что разрешает схема", async () => {
    // Список повторяет уже разрешённое: шаг 0,5 от 1 до 5. Новых состояний не
    // появляется — меняется способ ввода, а не набор допустимого. Шаг 0,25,
    // как в KetoDietCalculator, остаётся вопросом K7.
    renderForm();

    const options = within(
      nativeSelect(screen.getByLabelText(/Кетосоотношение/)),
    )
      .getAllByRole("option", { hidden: true })
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual([
      "",
      "5",
      "4.5",
      "4",
      "3.5",
      "3",
      "2.5",
      "2",
      "1.5",
      "1",
    ]);
  });

  it("выбранное значение уходит числом, а не строкой", async () => {
    // Схема назначения ждёт число: строка «4» провалила бы проверку молча.
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.selectOptions(
      nativeSelect(screen.getByLabelText(/Кетосоотношение/)),
      "4",
    );
    await user.click(screen.getByRole("button", { name: /Сохранить|Создать/ }));

    // Второй аргумент — событие формы, поэтому сверяется первый.
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ ratio: 4 });
  });

  it("в первом назначении не выбрано ничего — не 5 : 1", async () => {
    // Без пустого варианта браузер выбирал первый из списка — максимум, — и
    // первое назначение уходило с ним, если врач не заметил поля.
    const user = userEvent.setup();
    const onSubmit = renderForm(vi.fn(), {});

    expect(nativeSelect(screen.getByLabelText(/Кетосоотношение/)).value).toBe(
      "",
    );
    await user.click(screen.getByRole("button", { name: /Сохранить|Создать/ }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("углеводы считаются сами, как в KDC", () => {
  it("в записанном назначении не трогаются, пока не поменяли калорийность", async () => {
    renderForm();
    await screen.findByText(/120,0 г/);
    expect(valueControl(screen.getByLabelText(/Углеводы/))).toHaveValue(10);
  });

  it("пересчитываются после правки калорийности и не после ручной правки", async () => {
    renderForm();
    const user = userEvent.setup();
    const kcal = screen.getByLabelText(/Калорийность/);
    await user.clear(kcal);
    await user.type(kcal, "1300");
    const carbs = screen.getByLabelText(/Углеводы/);
    await vi.waitFor(() => expect(valueControl(carbs)).toHaveValue(10.3));

    await user.clear(carbs);
    await user.type(carbs, "8");
    (api.POST as Mock).mockResolvedValue({
      data: { ...GOAL, day: { ...GOAL.day, net_carbs_g: 12 } },
    });
    await user.type(kcal, "0");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(valueControl(carbs)).toHaveValue(8);
  });
});

describe("углеводы без числа приёмов (замечание диетолога 12.11.2026)", () => {
  it("первое назначение получает углеводы, пока приёмы не введены", async () => {
    (api.POST as Mock).mockResolvedValue({ data: { ...GOAL, meal: null } });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PrescriptionForm
          defaultValues={{
            ratio: 3,
            kcalPerDay: 1564,
            proteinG: 23,
            carbsLimitG: Number.NaN,
            mealsPerDay: Number.NaN,
            effectiveFrom: "2026-11-12",
          }}
          pending={false}
          error={null}
          onSubmit={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const carbs = screen.getByLabelText(/Углеводы/);
    await vi.waitFor(() => expect(valueControl(carbs)).toHaveValue(10.3));
    expect(api.POST).toHaveBeenCalledWith("/api/v1/calc/prescription-goal", {
      body: {
        ratio: 3,
        kcal_per_day: 1564,
        protein_g: 23,
        meals_per_day: undefined,
      },
    });
    // Без числа приёмов столбца «На приём» нет — только сутки.
    expect(screen.queryByText("На приём")).toBeNull();
  });
});

describe("жидкость по весу (Холлидей — Сегар)", () => {
  function renderWithHint(
    onSubmit = vi.fn(),
    carried: { proteinG?: number; fluidMlPerDay?: number } = {},
  ) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PrescriptionForm
          defaultValues={{
            ratio: 3.5,
            kcalPerDay: 1200,
            proteinG: carried.proteinG ?? Number.NaN,
            carbsLimitG: 10,
            mealsPerDay: 4,
            fluidMlPerDay: carried.fluidMlPerDay ?? Number.NaN,
            effectiveFrom: "2026-09-09",
            restrictions: "",
          }}
          pending={false}
          error={null}
          onSubmit={onSubmit}
          kcalHint={(apply) => (
            <button type="button" onClick={() => apply(1224, 18, 1400)}>
              Подставить
            </button>
          )}
        />
      </QueryClientProvider>,
    );
    return onSubmit;
  }

  it("необязательна: пустое поле не мешает сохранить", async () => {
    const onSubmit = renderWithHint(vi.fn(), { proteinG: 24 });
    const user = userEvent.setup();
    const fluid = screen.getByLabelText(/Жидкость/);
    expect(valueControl(fluid)).toHaveValue(null);
    await user.click(screen.getByRole("button", { name: /Сохранить/ }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(Number.isNaN(onSubmit.mock.calls[0]![0].fluidMlPerDay)).toBe(true);
  });

  it("пустое поле заполняется из подсказки, пока не правили руками", async () => {
    renderWithHint();
    const user = userEvent.setup();
    const fluid = screen.getByLabelText(/Жидкость/);
    const protein = screen.getByLabelText(/Белок/);
    // Пояснение о формуле — только у числа, которое поставила формула.
    expect(screen.queryByText(/формула Холлидея — Сегара/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Подставить" }));
    expect(valueControl(fluid)).toHaveValue(1400);
    expect(valueControl(protein)).toHaveValue(18);
    expect(screen.getByText(/формула Холлидея — Сегара/)).toBeInTheDocument();
    expect(screen.getByText(/1 г на кг/)).toBeInTheDocument();

    await user.clear(fluid);
    await user.type(fluid, "1000");
    await user.click(screen.getByRole("button", { name: "Подставить" }));
    expect(valueControl(fluid)).toHaveValue(1000);
    expect(screen.queryByText(/формула Холлидея — Сегара/)).toBeNull();
  });

  it("значения из прежней версии подсказка не перезаписывает", async () => {
    renderWithHint(vi.fn(), { proteinG: 24, fluidMlPerDay: 1200 });
    const user = userEvent.setup();
    const fluid = screen.getByLabelText(/Жидкость/);
    const protein = screen.getByLabelText(/Белок/);
    await user.click(screen.getByRole("button", { name: "Подставить" }));
    expect(valueControl(screen.getByLabelText(/Калорийность/))).toHaveValue(
      1224,
    );
    expect(valueControl(fluid)).toHaveValue(1200);
    expect(valueControl(protein)).toHaveValue(24);
    expect(screen.queryByText(/формула Холлидея — Сегара/)).toBeNull();
    expect(screen.queryByText(/1 г на кг/)).toBeNull();
  });

  it("вне границ 100-4000 мл — ошибка у поля", async () => {
    const onSubmit = renderWithHint();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Жидкость/), "50");
    await user.click(screen.getByRole("button", { name: /Сохранить/ }));
    expect(
      (await screen.findAllByText(/от 100 до 4000 мл/)).length,
    ).toBeGreaterThan(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
