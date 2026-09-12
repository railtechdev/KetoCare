import { describe, expect, it } from "vitest";

import { isRefusal } from "./assistantAnswer";

describe("isRefusal", () => {
  it("настоящий ответ отказом не считается", () => {
    expect(isRefusal({ status: "done", blocked: false })).toBe(false);
  });

  it("заменённый шаблоном — отказ", () => {
    // Шаблон врача, «нет материала» и исчерпанный предел приходят одинаково:
    // текст разный, признак один.
    expect(isRefusal({ status: "done", blocked: true })).toBe(true);
  });

  it("недоступность — отказ даже без признака", () => {
    // Страховка на случай, если признак когда-нибудь перестанут выставлять:
    // под «помощник недоступен» подпись о происхождении ответа бессмысленна.
    expect(isRefusal({ status: "failed" })).toBe(true);
  });

  it("ожидание отказом не считается", () => {
    // Под ожиданием подпись скрывает сам `ChatMessage`, и путать эти два
    // состояния нельзя: ответ ещё может прийти.
    expect(isRefusal({ status: "pending", blocked: false })).toBe(false);
  });
});
