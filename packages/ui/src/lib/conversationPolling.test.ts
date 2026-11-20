import { describe, expect, it } from "vitest";

import { mergeBySeq, nextAfterSeq } from "./conversationPolling";

describe("nextAfterSeq", () => {
  it("без кэша — переписка целиком", () => {
    expect(nextAfterSeq(undefined)).toBeUndefined();
  });

  it("ожидание заменяется ответом под тем же seq — читать с него", () => {
    // `replace_message` воркера кладёт ответ на место ожидания: чтение
    // «после последнего» ответа не увидело бы никогда.
    expect(
      nextAfterSeq([
        { seq: 0, status: "done" },
        { seq: 1, status: "done" },
        { seq: 2, status: "done" },
        { seq: 3, status: "pending" },
      ]),
    ).toBe(2);
  });

  it("без ожидания — после последнего сообщения", () => {
    expect(
      nextAfterSeq([
        { seq: 0, status: "done" },
        { seq: 1, status: "failed" },
      ]),
    ).toBe(1);
    expect(nextAfterSeq([])).toBe(-1);
  });
});

describe("mergeBySeq", () => {
  it("ответ встаёт на место ожидания, новые — в конец", () => {
    const merged = mergeBySeq(
      [
        { seq: 0, status: "done", text: "вопрос" },
        { seq: 1, status: "pending", text: "" },
      ],
      [
        { seq: 1, status: "done", text: "ответ" },
        { seq: 2, status: "done", text: "ещё вопрос" },
      ],
    );
    expect(merged.map((message) => [message.seq, message.text])).toEqual([
      [0, "вопрос"],
      [1, "ответ"],
      [2, "ещё вопрос"],
    ]);
  });
});
