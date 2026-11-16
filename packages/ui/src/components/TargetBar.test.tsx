import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TargetBar } from "./TargetBar";

function bar(kind: "goal" | "limit" | "minimum", value: number) {
  const { container } = render(
    <TargetBar
      kind={kind}
      label="Показатель"
      value={value}
      target={23}
      valueText="—"
    />,
  );
  return container.querySelector("[data-slot=progress]")!.className;
}

describe("TargetBar", () => {
  it("предел за границей — цвет опасности, цель за границей — предупреждения", () => {
    expect(bar("limit", 24)).toContain("bg-destructive");
    expect(bar("goal", 24)).toContain("bg-warning");
  });

  it("минимум сверх границы не окрашивается: это не перебор", () => {
    // Белок назначения «не меньше» (ADR-0087): 24 из 23 г — норма набрана.
    const className = bar("minimum", 24);
    expect(className).not.toContain("bg-warning");
    expect(className).not.toContain("bg-destructive");
  });

  it("до границы не окрашивается ни один вид", () => {
    for (const kind of ["goal", "limit", "minimum"] as const) {
      expect(bar(kind, 10)).not.toMatch(/bg-(warning|destructive)/);
    }
  });
});
