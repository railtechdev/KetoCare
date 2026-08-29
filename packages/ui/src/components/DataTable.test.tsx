import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DataTable, type DataTableLabels } from "./DataTable";

interface Row {
  name: string;
  value: number;
}

const COLUMNS = [
  { accessorKey: "name", header: "Название" },
  { accessorKey: "value", header: "Значение" },
];

const LABELS: DataTableLabels = {
  previousPage: "Назад",
  nextPage: "Вперёд",
  pageStatus: (page, total) => `Страница ${page} из ${total}`,
};

function renderTable(data: Row[], pageSize = 20) {
  return render(
    <DataTable
      columns={COLUMNS}
      data={data}
      emptyState="Записей пока нет"
      labels={LABELS}
      pageSize={pageSize}
      caption="Тестовая таблица"
    />,
  );
}

describe("DataTable", () => {
  it("показывает пустое состояние вместо пустой таблицы", () => {
    renderTable([]);
    expect(screen.getByText("Записей пока нет")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("рендерит строки и доступную подпись", () => {
    renderTable([
      { name: "Кетоны", value: 3 },
      { name: "Вес", value: 18 },
    ]);
    expect(
      screen.getByRole("table", { name: "Тестовая таблица" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Кетоны")).toBeInTheDocument();
    expect(screen.getByText("Вес")).toBeInTheDocument();
  });

  it("сортирует по клику и объявляет направление через aria-sort", async () => {
    const user = userEvent.setup();
    renderTable([
      { name: "Бета", value: 2 },
      { name: "Альфа", value: 1 },
    ]);

    const header = screen.getByRole("columnheader", { name: /Название/ });
    expect(header).not.toHaveAttribute("aria-sort");

    // Доступное имя кнопки — заголовок столбца: так скринридер понимает,
    // какой именно столбец сортируется.
    await user.click(screen.getByRole("button", { name: "Название" }));
    expect(
      screen.getByRole("columnheader", { name: /Название/ }),
    ).toHaveAttribute("aria-sort", "ascending");

    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(cells[0]).toBe("Альфа");
  });

  it("разбивает на страницы и не показывает навигацию на одной странице", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      name: `Строка ${i}`,
      value: i,
    }));

    const { rerender } = renderTable(many, 2);
    expect(screen.getByText("Страница 1 из 3")).toBeInTheDocument();

    rerender(
      <DataTable
        columns={COLUMNS}
        data={many}
        emptyState="Записей пока нет"
        labels={LABELS}
        pageSize={0}
        caption="Тестовая таблица"
      />,
    );
    expect(screen.queryByText(/Страница/)).not.toBeInTheDocument();
  });

  it("листает вперёд и назад", async () => {
    const user = userEvent.setup();
    renderTable(
      Array.from({ length: 4 }, (_, i) => ({ name: `Строка ${i}`, value: i })),
      2,
    );

    expect(screen.getByRole("button", { name: "Назад" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Вперёд" }));
    expect(screen.getByText("Страница 2 из 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Вперёд" })).toBeDisabled();
  });
});
