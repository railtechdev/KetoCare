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
    render(
      <DiaryEntryCard title="Обед" occurredAt={OCCURRED} source="ai_parsed" />,
    );
    const badge = screen.getByText("Распознано ИИ");
    expect(badge).toHaveAttribute("data-source", "ai_parsed");
    // Выделяется цветом предупреждения, а не как обычный источник
    expect(badge.className).toContain("text-warning");
  });

  it("обычный источник не помечается как ИИ", () => {
    render(<DiaryEntryCard title="Обед" occurredAt={OCCURRED} source="bot" />);
    const badge = screen.getByText("Бот");
    expect(badge).toHaveAttribute("data-source", "bot");
    expect(badge.className).not.toContain("text-warning");
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
