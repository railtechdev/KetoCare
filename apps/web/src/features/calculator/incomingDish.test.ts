import { describe, expect, it } from "vitest";

import { incomingDish, incomingRecipe, parseIncoming } from "./incomingDish";

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
