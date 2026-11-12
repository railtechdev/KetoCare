import { describe, expect, it } from "vitest";

import { FORBIDDEN_TERMS, forbiddenTermsIn } from "./forbiddenTerms";

describe("запрещённые слова", () => {
  it("ловит слово в любом месте словаря и называет ключ", () => {
    const found = forbiddenTermsIn("doctor", {
      prescription: { carbsDerived: "Считается, как в KDC." },
      ok: "Назначение",
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("doctor:prescription.carbsDerived");
  });

  it("не ловит обычные слова", () => {
    const plain = [
      "Меню на день",
      "Назначение",
      "Препарат",
      "В архиве",
      "Код входа",
      "Сервис",
      "Ядрышко",
      "Источники данных о продуктах",
    ];
    for (const text of plain)
      expect(
        FORBIDDEN_TERMS.filter(({ pattern }) => pattern.test(text)).map(
          ({ why }) => `${text}: ${why}`,
        ),
      ).toEqual([]);
  });
});
