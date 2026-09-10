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
    is_drug: true,
  },
  {
    id: "2",
    name_ru: "Вальпроат натрия",
    synonyms: ["Депакин"],
    sort: 1,
    retired: false,
    is_drug: true,
  },
  {
    id: "3",
    name_ru: "Выведенный из употребления",
    synonyms: [],
    sort: 2,
    retired: true,
    is_drug: true,
  },
  // Справочник заводился под анкету семьи, и вариантами ответа в нём стоят
  // строки, которые препаратами не являются.
  {
    id: "4",
    name_ru: "Не знаю названия",
    synonyms: ["не знаю"],
    sort: 3,
    retired: false,
    is_drug: false,
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
  });

  it("не предлагает строки, которые не лекарства", () => {
    // «Не знаю названия» — вариант ответа анкеты. Врач набирает «не», и выбор
    // подставил бы эту строку в схему лечения как название препарата.
    expect(matchDrugs(DRUGS, "не знаю")).toEqual([]);
    expect(matchDrugs(DRUGS, "названия")).toEqual([]);
  });

  it("на пустом и односимвольном запросе молчит", () => {
    // Форма открывается панелью, панель ставит фокус в первое поле. Подсказка
    // на пустом поле закрыла бы форму списком, а Enter вписал бы первый
    // препарат справочника, которого никто не набирал.
    expect(matchDrugs(DRUGS, "")).toEqual([]);
    expect(matchDrugs(DRUGS, "  ")).toEqual([]);
    expect(matchDrugs(DRUGS, "л")).toEqual([]);
    expect(matchDrugs(DRUGS, "ле").map((m) => m.drug.id)).toEqual(["1"]);
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
      {/* Не `output`: у него неявная роль status, и он спорил бы с живой
          областью самого поля. */}
      <div data-testid="value">{value}</div>
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

    await user.type(screen.getByLabelText("Препарат"), "вальпро");
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
    await user.keyboard("{ArrowDown}{Enter}");

    expect(submitted).toBe(false);
    expect(screen.getByTestId("value")).toHaveTextContent("Леветирацетам");
  });

  it("Enter без выбора отправляет форму, а не подставляет первое попавшееся", () => {
    // Обратная сторона: подставить вариант за человека, который ничего не
    // выбирал, значит вписать в схему лечения чужое название. Проверяется
    // отдельно, потому что это ровно тот случай, который случался на открытии
    // панели: фокус в поле, список раскрыт, Enter — и препарат назначен.
    return (async () => {
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

      expect(submitted).toBe(true);
      expect(screen.getByTestId("value")).toHaveTextContent("кеппра");
    })();
  });

  it("ArrowUp с ничего не выбранного берёт последний вариант", () => {
    return (async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.type(screen.getByLabelText("Препарат"), "а");
      await user.type(screen.getByLabelText("Препарат"), "т");
      await user.clear(screen.getByLabelText("Препарат"));
      await user.type(screen.getByLabelText("Препарат"), "ам");
      await screen.findByRole("listbox");
      await user.keyboard("{ArrowUp}{Enter}");

      const options = screen.queryAllByRole("option");
      expect(options.length).toBe(0);
      expect(screen.getByTestId("value")).toHaveTextContent(/[А-Яа-я]/);
    })();
  });

  it("Escape закрывает подсказку, оставляя набранное", () => {
    return (async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.type(screen.getByLabelText("Препарат"), "кеппра");
      await screen.findByRole("listbox");
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(screen.getByTestId("value")).toHaveTextContent("кеппра");
    })();
  });

  it("говорит вслух, что подставило название вместо набранного", () => {
    // Программная смена значения поля скринридером не объявляется: незрячий
    // врач набрал «Кеппра», а в поле оказался «Леветирацетам» — и он об этом
    // не узнает. Подмена названия препарата — худшее место для молчания.
    return (async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.type(screen.getByLabelText("Препарат"), "кеппра");
      const live = await screen.findByRole("status");
      expect(live).toHaveTextContent(/Подсказка/);

      await user.click(screen.getByRole("option", { name: /Леветирацетам/ }));
      expect(live).toHaveTextContent(/Подставлено название.*Леветирацетам/);
    })();
  });

  it("на точном совпадении подсказку не открывает", async () => {
    // Список из одной строки, повторяющей набранное, только закрывает поле.
    const user = userEvent.setup();
    render(<Harness initial="Леветирацетам" />);

    await user.click(screen.getByLabelText("Препарат"));

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});
