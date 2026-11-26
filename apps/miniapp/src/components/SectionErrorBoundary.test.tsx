import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import "../lib/i18n";
import { SectionErrorBoundary } from "./SectionErrorBoundary";

function Broken(): never {
  throw new Error("Failed to fetch dynamically imported module");
}

describe("раздел, который не открылся (аудит 26.11.2026, 1.12)", () => {
  it("говорит словами и даёт «Повторить», а не пустой экран", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <>
        <p>Сегодня</p>
        <SectionErrorBoundary>
          <Broken />
        </SectionErrorBoundary>
      </>,
    );

    // Соседнее содержимое осталось на месте — сломался только раздел.
    expect(screen.getByText("Сегодня")).toBeInTheDocument();
    expect(screen.getByText("Раздел не открылся")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeEnabled();
  });
});
