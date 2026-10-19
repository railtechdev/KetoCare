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
    expect(badge.className).toContain("text-warning-strong");
  });

  it("обычный источник не помечается как ИИ", () => {
    render(<DiaryEntryCard title="Обед" occurredAt={OCCURRED} source="bot" />);
    const badge = screen.getByText("Бот");
    expect(badge).toHaveAttribute("data-source", "bot");
    expect(badge.className).not.toContain("text-warning-strong");
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

  it("отображает категорию и главный числовой показатель с tabular-nums", () => {
    const { container } = render(
      <DiaryEntryCard
        title="Замер"
        occurredAt={OCCURRED}
        category="Кетоны"
        metric="3,2 ммоль/л"
      />,
    );

    expect(screen.getByText("Кетоны")).toBeInTheDocument();
    const metricEl = screen.getByText("3,2 ммоль/л");
    expect(metricEl).toBeInTheDocument();
    expect(metricEl.className).toContain("tabular-nums");
    expect(metricEl.className).toContain("text-metric");

    const timeEl = container.querySelector("time");
    expect(timeEl?.className).toContain("tabular-nums");
  });

  it("поддерживает статусы отклонений и подложки", () => {
    const { container, rerender } = render(
      <DiaryEntryCard
        title="Обед"
        occurredAt={OCCURRED}
        status="success"
      />,
    );

    const article = container.querySelector("article");
    expect(article).toHaveAttribute("data-status", "success");
    expect(article?.className).toContain("bg-success-subtle/30");

    rerender(
      <DiaryEntryCard
        title="Обед"
        occurredAt={OCCURRED}
        status="warning"
      />,
    );
    expect(article).toHaveAttribute("data-status", "warning");
    expect(article?.className).toContain("bg-warning-subtle/30");

    rerender(
      <DiaryEntryCard
        title="Обед"
        occurredAt={OCCURRED}
        status="destructive"
      />,
    );
    expect(article).toHaveAttribute("data-status", "destructive");
    expect(article?.className).toContain("bg-destructive-subtle/30");
  });
});

