// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  EMPTY_RECIPE_FILTERS,
  isRatioRangeInvalid,
  parseRatioBound,
  toRecipeSearchQuery,
  type RecipeFilters,
} from "./types";

function filters(patch: Partial<RecipeFilters>): RecipeFilters {
  return { ...EMPTY_RECIPE_FILTERS, ...patch };
}

describe("границы диапазона соотношения", () => {
  it("пустое поле — это отсутствие границы, а не ноль", () => {
    expect(parseRatioBound("")).toBeNull();
    expect(parseRatioBound("   ")).toBeNull();
    expect(parseRatioBound("0")).toBe(0);
  });

  it("нечисловой и отрицательный ввод границей не становится", () => {
    // Сервер принимает только ratio >= 0: отправив -1, экран получил бы 422
    // вместо выдачи, а пользователь — ошибку вместо пустого фильтра.
    expect(parseRatioBound("abc")).toBeNull();
    expect(parseRatioBound("-1")).toBeNull();
  });

  it("дробное значение сохраняется как есть", () => {
    expect(parseRatioBound("3.5")).toBe(3.5);
  });
});

describe("проверка диапазона", () => {
  it("начало больше конца — диапазон неверный", () => {
    expect(isRatioRangeInvalid(filters({ ratioMin: "4", ratioMax: "2" }))).toBe(
      true,
    );
  });

  it("равные границы допустимы: это поиск точного соотношения", () => {
    expect(isRatioRangeInvalid(filters({ ratioMin: "3", ratioMax: "3" }))).toBe(
      false,
    );
  });

  it("одна заданная граница диапазон не ломает", () => {
    expect(isRatioRangeInvalid(filters({ ratioMin: "4" }))).toBe(false);
    expect(isRatioRangeInvalid(filters({ ratioMax: "2" }))).toBe(false);
  });
});

describe("параметры GET /recipes", () => {
  it("незаполненные фильтры в запрос не попадают", () => {
    // Пустая строка в q ушла бы в полнотекстовый поиск и отсекла всю выдачу.
    expect(toRecipeSearchQuery(EMPTY_RECIPE_FILTERS)).toEqual({
      limit: EMPTY_RECIPE_FILTERS.limit,
      offset: 0,
    });
  });

  it("заполненные фильтры переносятся в имена параметров API", () => {
    expect(
      toRecipeSearchQuery(
        filters({
          q: "  запеканка  ",
          category: "breakfast",
          ratioMin: "3",
          ratioMax: "4.5",
          limit: 48,
        }),
      ),
    ).toEqual({
      q: "запеканка",
      category: "breakfast",
      ratio_min: 3,
      ratio_max: 4.5,
      limit: 48,
      offset: 0,
    });
  });

  it("нулевая нижняя граница остаётся фильтром", () => {
    expect(toRecipeSearchQuery(filters({ ratioMin: "0" }))).toMatchObject({
      ratio_min: 0,
    });
  });
});
