import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RatioBadge } from "./RatioBadge";

describe("RatioBadge", () => {
  it("показывает соответствие назначению, когда сервер его сообщил", () => {
    render(<RatioBadge ratio={3.94} withinTolerance />);
    const badge = screen.getByLabelText(/соответствует назначению/i);
    expect(badge).toHaveAttribute("data-state", "ok");
    expect(badge).toHaveTextContent("3.9 : 1");
  });

  it("показывает отклонение", () => {
    render(<RatioBadge ratio={2.5} withinTolerance={false} />);
    expect(screen.getByLabelText(/отклоняется от назначения/i)).toHaveAttribute(
      "data-state",
      "off",
    );
  });

  it("остаётся нейтральным без вердикта сервера", () => {
    // Допуск — медицинская константа ядра; компонент не имеет права решать сам,
    // иначе интерфейс и расчётное ядро со временем разойдутся.
    render(<RatioBadge ratio={3.94} />);
    const badge = screen.getByLabelText("Соотношение 3.9 : 1");
    expect(badge).toHaveAttribute("data-state", "neutral");
  });

  it("обрабатывает неопределённое соотношение (нет белков и углеводов)", () => {
    render(<RatioBadge ratio={null} />);
    expect(
      screen.getByLabelText("Соотношение не определено"),
    ).toHaveTextContent(/^—$/);
  });

  it("с целью показывает вердикт сервера: в допуске", () => {
    render(<RatioBadge ratio={3.95} targetRatio={4.0} withinTolerance />);
    const badge = screen.getByLabelText(/Цель: 4.0 : 1/i);
    expect(badge).toHaveAttribute("data-state", "ok");
    expect(badge.className).toContain("bg-success-subtle");
    expect(badge).toHaveTextContent("(Цель: 4.0 : 1)");
  });

  it("с целью показывает вердикт сервера: отклонение", () => {
    render(
      <RatioBadge ratio={3.85} targetRatio={4.0} withinTolerance={false} />,
    );
    const badge = screen.getByLabelText(/Цель: 4.0 : 1/i);
    expect(badge).toHaveAttribute("data-state", "off");
    expect(badge.className).toContain("text-warning-strong");
  });

  it("с целью, но без вердикта сервера — нейтральный, даже если число рядом с целью", () => {
    // Аудит расчётов 13.11.2026: значок решал сам по копии допуска и ставил
    // зелёную галочку у устаревшего состава и у дня без вердикта.
    render(<RatioBadge ratio={4.0} targetRatio={4.0} />);
    const badge = screen.getByLabelText(/Цель: 4.0 : 1/i);
    expect(badge).toHaveAttribute("data-state", "neutral");
    expect(badge.className).not.toContain("success");
    expect(badge).toHaveAccessibleName(/^Соотношение 4.0 : 1\./);
  });
});
