import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import { DrugNameField, matchDrugs } from "./DrugNameField";
import type { AedDrug } from "../intake/useIntake";

i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

const DRUGS: AedDrug[] = [
  {
    id: "1",
    name_ru: "Леветирацетам",
    synonyms: ["Кеппра", "Летирам"],
    sort: 0,
    retired: false,
  },
  {
    id: "2",
    name_ru: "Вальпроат натрия",
    synonyms: ["Депакин"],
    sort: 1,
    retired: false,
  },
  {
    id: "3",
    name_ru: "Выведенный из употребления",
    synonyms: [],
    sort: 2,
    retired: true,
  },
];

describe("подбор препарата по справочнику", () => {
  it("ищет и по названию, и по синониму", () => {
    // «Кеппра», «Летирам» и «Леветирацетам» — одно вещество. Врач набирает то
    // написание, которое привык видеть на упаковке; искать только по
    // каноническому значило бы не найти ничего в половине случаев.
    expect(matchDrugs(DRUGS, "левети").map((m) => m.drug.id)).toEqual(["1"]);
    expect(matchDrugs(DRUGS, "кеппра").map((m) => m.drug.id)).toEqual(["1"]);
  });

  it("говорит, каким синонимом нашлось", () => {
    // Иначе подсказка выглядит подменой: набрал «Кеппра» — предлагают
    // «Леветирацетам», и непонятно, то ли это вообще.
    expect(matchDrugs(DRUGS, "кеппра")[0]?.via).toBe("Кеппра");
    expect(matchDrugs(DRUGS, "левети")[0]?.via).toBeNull();
  });

  it("не предлагает выведенные из употребления", () => {
    // Их держат ради уже заполненных анкет, а не ради новых назначений.
    expect(matchDrugs(DRUGS, "выведен")).toEqual([]);
    expect(matchDrugs(DRUGS, "").map((m) => m.drug.id)).toEqual(["1", "2"]);
  });

  it("не различает регистр", () => {
    expect(matchDrugs(DRUGS, "ДЕПАКИН").map((m) => m.drug.id)).toEqual(["2"]);
  });
});

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DrugNameField
        id="drug"
        label="Препарат"
        value={value}
        onChange={setValue}
        drugs={DRUGS}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("поле названия препарата", () => {
  it("подставляет каноническое название, когда набран синоним", async () => {
    // Два написания одного препарата в одной карте ломают подсчёт
    // приверженности и делают несравнимыми отметки о приёме.
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Препарат"), "кеппра");
    await user.click(
      await screen.findByRole("option", { name: /Леветирацетам/ }),
    );

    expect(screen.getByTestId("value")).toHaveTextContent("Леветирацетам");
  });

  it("оставляет набранное, чего в справочнике нет", async () => {
    // Справочник неполон: закрыть список значило бы запретить врачу назначить
    // препарат, которого в нём ещё нет.
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Препарат"), "Топирамат-АКОС");

    expect(screen.getByTestId("value")).toHaveTextContent("Топирамат-АКОС");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("выбирается с клавиатуры, а не только мышью", async () => {
    // Врач заполняет схему с клавиатуры. Подсказка, доступная только мышью, —
    // это подсказка, которой не пользуются.
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Препарат"), "а");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(screen.getByTestId("value")).toHaveTextContent("Вальпроат натрия");
  });

  it("Enter при открытой подсказке не отправляет форму", async () => {
    // Иначе назначение уходило бы на сервер с недонабранным названием.
    const user = userEvent.setup();
    let submitted = false;
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = true;
        }}
      >
        <Harness />
        <button type="submit">Сохранить</button>
      </form>,
    );

    await user.type(screen.getByLabelText("Препарат"), "кеппра");
    await screen.findByRole("listbox");
    await user.keyboard("{Enter}");

    expect(submitted).toBe(false);
    expect(screen.getByTestId("value")).toHaveTextContent("Леветирацетам");
  });

  it("на точном совпадении подсказку не открывает", async () => {
    // Список из одной строки, повторяющей набранное, только закрывает поле.
    const user = userEvent.setup();
    render(<Harness initial="Леветирацетам" />);

    await user.click(screen.getByLabelText("Препарат"));

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});
