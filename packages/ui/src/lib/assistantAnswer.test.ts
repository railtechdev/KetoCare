import { describe, expect, it } from "vitest";

import { isRefusal, refusalNextStep } from "./assistantAnswer";

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
    // Не страховка, а живой путь: ручка, у которой не встала задача в очередь,
    // пишет «помощник недоступен» только со `status`, без `blocked`
    // (ADR-0035). Убери это условие — под ним вернётся ложная подпись.
    expect(isRefusal({ status: "failed" })).toBe(true);
  });

  it("ожидание отказом не считается", () => {
    // Под ожиданием подпись скрывает сам `ChatMessage`, и путать эти два
    // состояния нельзя: ответ ещё может прийти.
    expect(isRefusal({ status: "pending", blocked: false })).toBe(false);
  });
});

describe("refusalNextStep", () => {
  it("у ответа шага нет", () => {
    expect(refusalNextStep({ status: "done", blocked: false })).toBeNull();
    expect(refusalNextStep({ status: "pending" })).toBeNull();
  });

  it("отклонённый вопрос — к врачу", () => {
    expect(refusalNextStep({ status: "done", blocked: true })).toBe("doctor");
  });

  it("недоступность — повтор, с признаком и без", () => {
    expect(refusalNextStep({ status: "failed" })).toBe("retry");
    expect(refusalNextStep({ status: "failed", blocked: true })).toBe("retry");
  });

  it("исчерпанный предел — без «спросите врача»", () => {
    // Текст предела говорит «завтра»; врач на вопросы о приложении не
    // отвечает, и совет к нему здесь был бы ложным шагом.
    expect(
      refusalNextStep({ status: "done", blocked: true, limited: true }),
    ).toBe("none");
  });
});
