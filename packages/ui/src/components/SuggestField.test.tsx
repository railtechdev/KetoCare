import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Input } from "./ui/input";
import { SuggestField } from "./SuggestField";

const FRUITS = ["Авокадо", "Абрикос", "Ананас"];

/**
 * Обёртка повторяет то, как примитив используют на месте: состояние открытия и
 * подсветки держит вызывающая сторона.
 *
 * `initialActive` — то самое различие, ради которого примитив не прячет Enter:
 * 0 означает «первый вариант предложен», −1 — «не выбрано ничего».
 */
function Harness({
  onPick,
  initialActive = 0,
  announcement = "",
}: {
  onPick: (option: string) => void;
  initialActive?: number;
  announcement?: string;
}) {
  const [open, setOpen] = useState(true);
  const [activeIndex, setActiveIndex] = useState(initialActive);

  return (
    <SuggestField
      options={FRUITS}
      open={open}
      onOpenChange={setOpen}
      activeIndex={activeIndex}
      onActiveIndexChange={setActiveIndex}
      onPick={onPick}
      announcement={announcement}
      listLabel="Подсказки"
      optionKey={(option) => option}
      renderOption={(option) => <span>{option}</span>}
    >
      {(aria) => <Input aria-label="Поиск" {...aria} defaultValue="а" />}
    </SuggestField>
  );
}

describe("SuggestField", () => {
  it("поле связано со списком и называет подсвеченный вариант", async () => {
    render(<Harness onPick={vi.fn()} />);

    const input = screen.getByRole("combobox", { name: "Поиск" });
    const list = screen.getByRole("listbox", { name: "Подсказки" });

    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", list.id);
    expect(input).toHaveAttribute("aria-activedescendant", `${list.id}-0`);
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("стрелки ходят по кругу, Escape закрывает", async () => {
    const user = userEvent.setup();
    render(<Harness onPick={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: "Поиск" });
    const listId = screen.getByRole("listbox").id;

    input.focus();
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", `${listId}-1`);

    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", `${listId}-2`);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Enter берёт подсвеченный вариант", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);

    screen.getByRole("combobox", { name: "Поиск" }).focus();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onPick).toHaveBeenCalledWith("Абрикос");
  });

  it("когда не выбрано ничего, Enter подсказку не трогает", async () => {
    // Ради этого случая различие и оставлено на виду: поле, которое И ЕСТЬ
    // значение (название препарата), не должно подставлять первый вариант за
    // человека, который ничего не выбирал.
    const user = userEvent.setup();
    const onPick = vi.fn();
    const submitted = vi.fn((event: { preventDefault: () => void }) =>
      event.preventDefault(),
    );
    render(
      <form onSubmit={submitted}>
        <Harness onPick={onPick} initialActive={-1} />
      </form>,
    );

    const input = screen.getByRole("combobox", { name: "Поиск" });
    input.focus();
    await user.keyboard("{Enter}");

    expect(onPick).not.toHaveBeenCalled();
    expect(input).not.toHaveAttribute("aria-activedescendant");
    // Enter остаётся ОБЫЧНЫМ: подсказка его не съедает, форма отправляется.
    // Без этой проверки страж «ничего не подсвечено» можно было снять молча —
    // `options[-1]` и так не существует, и подстановки не случалось бы, но
    // отправка формы пропадала бы.
    expect(submitted).toHaveBeenCalled();
  });

  it("выбор идёт по mousedown, а не по click", async () => {
    // click срабатывает после blur поля, и список успевает закрыться раньше
    // выбора: щелчок по подсказке не давал ничего.
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);

    const option = screen.getByRole("option", { name: "Ананас" });
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onPick).toHaveBeenCalledWith("Ананас");
  });

  it("живая область произносит то, что передали", () => {
    // Её забыли при копировании механики в третий раз — поэтому она встроена.
    render(<Harness onPick={vi.fn()} announcement="Найдено 3" />);

    expect(screen.getByRole("status")).toHaveTextContent("Найдено 3");
  });

  it("фокус в поле список не закрывает", async () => {
    // Поле — часть виджета: Radix считает внешним всё, что не содержимое
    // всплывающего, и закрывался на фокус в поле. Копии спасались обратным
    // открытием по `onFocus`, но фокус приходит и без ввода — Tab, установка
    // после неудачной отправки формы.
    render(<Harness onPick={vi.fn()} />);

    screen.getByRole("combobox", { name: "Поиск" }).focus();

    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("пустой список не открывается", () => {
    render(
      <SuggestField
        options={[]}
        open
        onOpenChange={() => {}}
        activeIndex={0}
        onActiveIndexChange={() => {}}
        onPick={() => {}}
        announcement=""
        optionKey={(option: string) => option}
        renderOption={(option: string) => <span>{option}</span>}
      >
        {(aria) => <Input aria-label="Поиск" {...aria} />}
      </SuggestField>,
    );

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Поиск" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
