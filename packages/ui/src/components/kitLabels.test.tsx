import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { type KitLabels } from "../lib/kitLabels";
import { KitLabelsProvider } from "./KitLabelsProvider";
import { DiaryEntryCard } from "./DiaryEntryCard";
import { MacroBar } from "./MacroBar";
import { MacroFacts } from "./MacroFacts";
import { RatioBadge } from "./RatioBadge";

/**
 * Предметные компоненты кита не печатают своих слов, когда приложение дало
 * свои (ADR-0052): узбекская семья не должна видеть «Жиры» и «ккал» посреди
 * латиницы. Проверяется вся разметка, включая `aria-label` и скрытые подписи
 * для программы чтения с экрана — их глазами не видно, а слышно.
 */
const LATIN: KitLabels = {
  macros: {
    fat: "Yog'lar",
    protein: "Oqsillar",
    carbs: "Uglevodlar",
    kcalFull: "Kaloriya, kkal",
    fatFull: "Yog'lar, g",
    proteinFull: "Oqsillar, g",
    carbsFull: "Uglevodlar, g",
    fatShort: "Y",
    proteinShort: "O",
    carbsShort: "U",
    gramsUnit: "g",
    kcalUnit: "kkal",
  },
  ratio: {
    unknown: "Nisbat aniqlanmagan",
    plain: (value) => `Nisbat ${value}`,
    within: (value) => `Nisbat ${value}, mos`,
    off: (value) => `Nisbat ${value}, mos emas`,
  },
  diarySource: {
    web: "Veb",
    bot: "Bot",
    miniapp: "Ilova",
    ai_parsed: "AI tanidi",
  },
};

const CYRILLIC = /[Ѐ-ӿ]/;

function markup(node: ReactNode): string {
  const { container } = render(
    <KitLabelsProvider labels={LATIN}>{node}</KitLabelsProvider>,
  );
  return container.innerHTML;
}

const CASES: [string, ReactNode][] = [
  [
    "MacroBar",
    <MacroBar
      key="bar"
      fatG={40}
      proteinG={10}
      carbsG={5}
      netCarbs={{ grams: 3, label: "Sof uglevodlar", note: "nisbat" }}
    />,
  ],
  [
    "MacroFacts",
    <MacroFacts
      key="facts"
      label="Mahsulot"
      kcal={367}
      fatG={40}
      proteinG={1}
      carbsG={0.5}
    />,
  ],
  ["RatioBadge без числа", <RatioBadge key="none" ratio={null} />],
  ["RatioBadge без вердикта", <RatioBadge key="plain" ratio={3.9} />],
  ["RatioBadge в допуске", <RatioBadge key="ok" ratio={3.9} withinTolerance />],
  [
    "RatioBadge вне допуска",
    <RatioBadge key="off" ratio={3.1} withinTolerance={false} />,
  ],
  ...(["web", "bot", "miniapp", "ai_parsed"] as const).map(
    (source) =>
      [
        `DiaryEntryCard (${source})`,
        <DiaryEntryCard
          key={source}
          title="Keton"
          occurredAt={new Date("2026-10-05T08:00:00Z")}
          source={source}
        />,
      ] as [string, ReactNode],
  ),
];

describe("подписи кита из словаря приложения", () => {
  it.each(CASES)("%s не печатает кириллицу", (_name, node) => {
    expect(markup(node)).not.toMatch(CYRILLIC);
  });

  it("подпись соотношения для программы чтения — из словаря", () => {
    const { getByLabelText } = render(
      <KitLabelsProvider labels={LATIN}>
        <RatioBadge ratio={3.9} withinTolerance />
      </KitLabelsProvider>,
    );
    expect(getByLabelText("Nisbat 3.9 : 1, mos")).toBeInTheDocument();
  });
});
