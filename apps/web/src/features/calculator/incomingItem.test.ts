import { describe, expect, it } from "vitest";

import {
  incomingDish,
  incomingRecipe,
  ownedByChild,
  parseIncoming,
} from "./incomingItem";

describe("что приходит в калькулятор через ?item=", () => {
  it("голый идентификатор — это продукт из справочника", () => {
    // Прежний договор: справочник присылал идентификатор продукта, и ломать
    // его нельзя — ссылки «В калькулятор» уже разошлись по экранам.
    expect(parseIncoming("11111111-1111-4111-8111-111111111111")).toEqual({
      kind: "product",
      id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("рецепт и своё блюдо различаются приставкой", () => {
    expect(parseIncoming(incomingRecipe("r1"))).toEqual({
      kind: "recipe",
      id: "r1",
    });
    expect(parseIncoming(incomingDish("d1"))).toEqual({
      kind: "dish",
      id: "d1",
    });
  });

  it("пустое значение — это ничего, а не пустой продукт", () => {
    expect(parseIncoming(undefined)).toBeNull();
    expect(parseIncoming("")).toBeNull();
  });
});

describe("что из адреса принадлежит ребёнку", () => {
  it("своё блюдо — да, рецепт, продукт и пустое — нет", () => {
    expect(ownedByChild(incomingDish("d1"))).toBe(true);
    expect(ownedByChild(incomingRecipe("r1"))).toBe(false);
    expect(ownedByChild("11111111-1111-4111-8111-111111111111")).toBe(false);
    expect(ownedByChild(undefined)).toBe(false);
  });
});
