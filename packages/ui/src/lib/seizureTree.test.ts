import { describe, expect, it } from "vitest";

import {
  hasSeizureTree,
  seizureChildren,
  seizureNodeByRef,
  seizureParentRef,
  unknownSeizureType,
} from "./seizureTree";

/*
 * Справочник ILAE 2025 в форме ответа API — те же узлы, что в тестах бота
 * (`apps/bot/tests/test_seizure.py`, `ILAE`): узла «3.3» нет, «3.3.1» висит
 * прямо под «3». Случаи тоже те же — правило дерева одно на оба канала.
 */
const ILAE: [string, string][] = [
  ["1", "Фокальный приступ"],
  ["1.1", "Фокальный приступ с сохранением сознания"],
  ["1.2", "Фокальный приступ с нарушением сознания"],
  ["3", "Генерализованный приступ"],
  ["3.1", "Абсанс"],
  ["3.1.1", "Типичный абсанс"],
  ["3.2", "Генерализованный тонико-клонический приступ"],
  ["3.3.1", "Генерализованный миоклонический приступ"],
  ["4", "Неклассифицированный приступ"],
];
const NODES = ILAE.map(([ref, name]) => ({
  id: `id-${ref}`,
  name,
  ilaeRef: ref,
}));

function names(children: ReturnType<typeof seizureChildren>): string[] {
  return children.map((child) =>
    child.hasChildren ? `${child.node.name} ›` : child.node.name,
  );
}

describe("дерево типов приступов", () => {
  it("верхний уровень — ближайший существующий предок, как в боте", () => {
    expect(names(seizureChildren(NODES, null))).toEqual([
      "Фокальный приступ ›",
      "Генерализованный приступ ›",
      "Неклассифицированный приступ",
    ]);
  });

  it("группа отдаёт свои подтипы, а не внуков", () => {
    const labels = names(seizureChildren(NODES, "3"));
    // «3.3.1» без «3.3» — под «3»: здесь, а не потерян.
    expect(labels).toContain("Генерализованный миоклонический приступ");
    expect(labels).toContain("Абсанс ›");
    expect(labels).not.toContain("Типичный абсанс");
  });

  it("родитель — ближайший существующий номер", () => {
    const existing = new Set(ILAE.map(([ref]) => ref));
    expect(seizureParentRef("3.3.1", existing)).toBe("3");
    expect(seizureParentRef("3.1.1", existing)).toBe("3.1");
    expect(seizureParentRef("1", existing)).toBeNull();
  });

  it("«Не знаю» — узел «4» справочника, а не значение приложения", () => {
    expect(unknownSeizureType(NODES)?.id).toBe("id-4");
    expect(
      unknownSeizureType(NODES.filter((node) => node.ilaeRef !== "4")),
    ).toBeNull();
  });

  it("тип без номера стоит на верхнем уровне", () => {
    const extra = { id: "own", name: "Свой тип клиники", ilaeRef: null };
    const top = seizureChildren([...NODES, extra], null);
    expect(top.map((child) => child.node.id)).toContain("own");
    expect(top.find((child) => child.node.id === "own")?.hasChildren).toBe(
      false,
    );
  });

  it("справочник без номеров — не дерево, а плоский список", () => {
    const flat = [
      { id: "a", name: "Тонико-клонический" },
      { id: "b", name: "Абсанс", ilaeRef: null },
    ];
    expect(hasSeizureTree(flat)).toBe(false);
    expect(hasSeizureTree(NODES)).toBe(true);
  });

  it("узел находится по номеру", () => {
    expect(seizureNodeByRef(NODES, "3.1")?.name).toBe("Абсанс");
    expect(seizureNodeByRef(NODES, "9")).toBeNull();
  });
});
