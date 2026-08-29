import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AsyncSection } from "./AsyncSection";

function renderSection(overrides: Partial<Parameters<typeof AsyncSection>[0]>) {
  return render(
    <AsyncSection
      loading={false}
      skeleton={<p>скелетон</p>}
      error={null}
      retryLabel="Повторить"
      onRetry={vi.fn()}
      isEmpty={false}
      empty={<p>пусто</p>}
      {...overrides}
    >
      <p>данные</p>
    </AsyncSection>,
  );
}

describe("AsyncSection", () => {
  it("показывает данные, когда всё в порядке", () => {
    renderSection({});
    expect(screen.getByText("данные")).toBeInTheDocument();
  });

  it("ошибка не прячет уже показанные данные", () => {
    // Ровно та ошибка, ради которой компонент и существует: TanStack Query при
    // неудачном обновлении сохраняет прежний ответ, а экраны рисовали ошибку
    // вместо списка — родитель видел красный блок вместо своих записей.
    renderSection({ error: { title: "Не удалось обновить" } });

    expect(screen.getByText("данные")).toBeInTheDocument();
    expect(screen.getByText("Не удалось обновить")).toBeInTheDocument();
  });

  it("ошибка без данных показывается вместо содержимого", () => {
    renderSection({ error: { title: "Не удалось загрузить" }, isEmpty: true });

    expect(screen.getByText("Не удалось загрузить")).toBeInTheDocument();
    expect(screen.queryByText("пусто")).not.toBeInTheDocument();
    expect(screen.queryByText("данные")).not.toBeInTheDocument();
  });

  it("ошибка и пустое состояние не показываются вместе", () => {
    // «Записей нет» рядом с «загрузить не удалось» — утверждение о данных,
    // которого никто не проверял.
    renderSection({ error: { title: "Сбой" }, isEmpty: true });
    expect(screen.queryByText("пусто")).not.toBeInTheDocument();
  });

  it("скелетон только пока показывать нечего", () => {
    renderSection({ loading: true, isEmpty: true });
    expect(screen.getByText("скелетон")).toBeInTheDocument();

    renderSection({ loading: true, isEmpty: false });
    expect(screen.getAllByText("данные")).toHaveLength(1);
  });

  it("пустое состояние — когда данных нет и ошибки нет", () => {
    renderSection({ isEmpty: true });
    expect(screen.getByText("пусто")).toBeInTheDocument();
  });

  it("кнопка повтора вызывает переданный обработчик", async () => {
    const onRetry = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    renderSection({ error: { title: "Сбой" }, isEmpty: true, onRetry });

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Повторить" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
