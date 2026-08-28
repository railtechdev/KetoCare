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
    ).toHaveTextContent("— : 1");
  });
});
