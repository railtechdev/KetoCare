import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Section } from "./Section";

describe("Section", () => {
  it("выдаёт заголовок второго уровня по умолчанию", () => {
    // То, ради чего компонент и появился: до него блок обозначался `CardTitle`,
    // который кит рисует как `div`, и из 72 файлов экранов только 6 выдавали
    // в разметку хоть один `h2` — навигация по заголовкам не работала.
    render(
      <Section title="Итоги дня">
        <p>содержимое</p>
      </Section>,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Итоги дня" }),
    ).toBeInTheDocument();
  });

  it("вложенный блок получает третий уровень", () => {
    render(
      <Section title="Завтрак" level={3}>
        <p>содержимое</p>
      </Section>,
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Завтрак" }),
    ).toBeInTheDocument();
  });

  it("скрытый заголовок остаётся заголовком для скринридера", () => {
    render(
      <Section title="Фильтры" titleHidden>
        <p>содержимое</p>
      </Section>,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Фильтры" }),
    ).toBeInTheDocument();
  });

  it("показывает пояснение и действие блока", () => {
    render(
      <Section
        title="Продукты"
        description="Пищевая ценность на 100 г"
        action={<button type="button">Добавить</button>}
      >
        <p>содержимое</p>
      </Section>,
    );

    expect(screen.getByText("Пищевая ценность на 100 г")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Добавить" }),
    ).toBeInTheDocument();
  });
});
