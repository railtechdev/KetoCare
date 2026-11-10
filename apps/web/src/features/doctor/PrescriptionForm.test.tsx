import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../lib/api";
import "../../lib/i18n";
import { PrescriptionForm } from "./PrescriptionForm";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { POST: vi.fn() } };
});

const GOAL = {
  day: { fat_g: 120, protein_g: 24, net_carbs_g: 10.3, non_fat_g: 34.3 },
  meal: { fat_g: 30, protein_g: 6, net_carbs_g: 2.6, non_fat_g: 8.6 },
  engine_version: "1.3.0",
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
    expect(field.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "4.0 : 1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "3.5 : 1" })).toBeInTheDocument();
  });

  it("предлагает ровно те значения, что разрешает схема", async () => {
    // Список повторяет уже разрешённое: шаг 0,5 от 1 до 5. Новых состояний не
    // появляется — меняется способ ввода, а не набор допустимого. Шаг 0,25,
    // как в KetoDietCalculator, остаётся вопросом K7.
    renderForm();

    const options = screen
      .getAllByRole("option")
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

    await user.selectOptions(screen.getByLabelText(/Кетосоотношение/), "4");
    await user.click(screen.getByRole("button", { name: /Сохранить|Создать/ }));

    // Второй аргумент — событие формы, поэтому сверяется первый.
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ ratio: 4 });
  });

  it("в первом назначении не выбрано ничего — не 5 : 1", async () => {
    // Без пустого варианта браузер выбирал первый из списка — максимум, — и
    // первое назначение уходило с ним, если врач не заметил поля.
    const user = userEvent.setup();
    const onSubmit = renderForm(vi.fn(), {});

    expect(
      (screen.getByLabelText(/Кетосоотношение/) as HTMLSelectElement).value,
    ).toBe("");
    await user.click(screen.getByRole("button", { name: /Сохранить|Создать/ }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
