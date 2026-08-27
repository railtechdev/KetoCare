import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiaryEntryCard } from "./DiaryEntryCard";

const OCCURRED = new Date("2026-03-14T09:05:00Z");

describe("DiaryEntryCard", () => {
  it("показывает заголовок и машиночитаемое время", () => {
    render(<DiaryEntryCard title="Приступ" occurredAt={OCCURRED} />);

    expect(
      screen.getByRole("heading", { name: "Приступ" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("time")).toHaveAttribute(
      "dateTime",
      OCCURRED.toISOString(),
    );
  });

  it("помечает записи, разобранные ИИ", () => {
    // Родителю важно видеть, что запись распознана автоматически и её стоит
    // перепроверить (раздел 10.3 ТЗ: подтверждение перед сохранением).
    const { container } = render(
      <DiaryEntryCard title="Обед" occurredAt={OCCURRED} source="ai_parsed" />,
    );
    expect(screen.getByText("Распознано ИИ")).toBeInTheDocument();
    expect(
      container.querySelector(".kc-diary-card__source--ai"),
    ).not.toBeNull();
  });

  it("обычный источник не помечается как ИИ", () => {
    const { container } = render(
      <DiaryEntryCard title="Обед" occurredAt={OCCURRED} source="bot" />,
    );
    expect(screen.getByText("Бот")).toBeInTheDocument();
    expect(container.querySelector(".kc-diary-card__source--ai")).toBeNull();
  });

  it("рендерит содержимое и действия", () => {
    render(
      <DiaryEntryCard
        title="Кетоны"
        occurredAt={OCCURRED}
        actions={<button type="button">Изменить</button>}
      >
        <p>3.2 ммоль/л</p>
      </DiaryEntryCard>,
    );
    expect(screen.getByText("3.2 ммоль/л")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Изменить" }),
    ).toBeInTheDocument();
  });
});
