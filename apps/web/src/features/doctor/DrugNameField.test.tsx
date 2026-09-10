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
  {
    id: "5",
    name_ru: "Топирамат",
    synonyms: ["Топамакс"],
    sort: 4,
    retired: false,
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

  it("Enter без выбора отправляет форму, а не подставляет первое попавшееся", async () => {
    // Обратная сторона: подставить вариант за человека, который ничего не
    // выбирал, значит вписать в схему лечения чужое название. Проверяется
    // отдельно, потому что это ровно тот случай, который случался на открытии
    // панели: фокус в поле, список раскрыт, Enter — и препарат назначен.
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
  });

  it("ArrowUp с ничего не выбранного берёт ПОСЛЕДНИЙ вариант", async () => {
    // Запрос подобран так, чтобы совпадений было два: на одном совпадении
    // первый и последний — один элемент, и проверка не различала бы ничего.
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Препарат"), "ам");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);

    await user.keyboard("{ArrowUp}{Enter}");

    // Последний в списке — «Топирамат»: порядок совпадений повторяет порядок
    // справочника.
    expect(screen.getByTestId("value")).toHaveTextContent("Топирамат");
  });

  it("ArrowDown с ничего не выбранного берёт первый", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Препарат"), "ам");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(screen.getByTestId("value")).toHaveTextContent("Леветирацетам");
  });

  it("Escape закрывает подсказку, оставляя набранное", async () => {
    // Закрывает её Radix (`DismissableLayer` гасит верхний слой), а не наша
    // ветка — своей в коде нет. Проверяется то, что важно человеку: подсказка
    // ушла, набранное осталось, и форма при этом НЕ закрылась.
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Препарат"), "кеппра");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByTestId("value")).toHaveTextContent("кеппра");
    expect(screen.getByLabelText("Препарат")).toBeInTheDocument();
  });

  it("возвращаясь в заполненное поле, подсказку показывает снова", async () => {
    // Врач ушёл к дозе, вернулся поправить название — подсказка нужна снова.
    // Без этого она появлялась бы только при наборе новых букв.
    const user = userEvent.setup();
    render(
      <>
        <Harness initial="кеппра" />
        <input aria-label="Соседнее поле" />
      </>,
    );

    await user.click(screen.getByLabelText("Соседнее поле"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Препарат"));
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
  });

  it("у списка подсказок есть имя для скринридера", async () => {
    // Без имени скринридер объявляет «список», и непонятно, чего именно.
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Препарат"), "кеппра");

    expect(
      await screen.findByRole("listbox", { name: "Из справочника" }),
    ).toBeInTheDocument();
  });

  it("говорит вслух, что подставило название вместо набранного", async () => {
    // Программная смена значения поля скринридером не объявляется: незрячий
    // врач набрал «Кеппра», а в поле оказался «Леветирацетам» — и он об этом
    // не узнает. Подмена названия препарата — худшее место для молчания.
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Препарат"), "кеппра");
    const live = await screen.findByRole("status");
    expect(live).toHaveTextContent(/Подсказка/);

    await user.click(screen.getByRole("option", { name: /Леветирацетам/ }));
    expect(live).toHaveTextContent(/Подставлено название.*Леветирацетам/);
  });

  it("на точном совпадении подсказку не открывает", async () => {
    // Список из одной строки, повторяющей набранное, только закрывает поле.
    const user = userEvent.setup();
    render(<Harness initial="Леветирацетам" />);

    await user.click(screen.getByLabelText("Препарат"));

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});
