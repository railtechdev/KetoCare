// @vitest-environment node
import { describe, expect, it } from "vitest";

import { totp } from "../../e2e/src/totp";

/**
 * Контракт `apps/e2e/src/totp.ts` с сидом прогонов (`infra/scripts/seed_e2e.py`).
 *
 * Сид принимает строчный секрет, потому что прогон САМ приводит его к верхнему
 * регистру, а `pyotp` декодирует с `casefold=True`. Снятие `.toUpperCase()` в
 * `totp.ts` не роняло ни одного теста в `infra/tests` — стык держался словом.
 * По правилу «стык проверяется на стороне поставщика» тест стоит здесь (#207).
 */
const SECRET = "KETOCAREE2ETOTPSECRET234567ABCDE";
const AT = 1_700_000_000_000;

describe("контракт totp.ts с сидом прогонов", () => {
  it("строчный секрет даёт тот же код, что и заглавный", () => {
    expect(totp(SECRET.toLowerCase(), AT)).toBe(totp(SECRET, AT));
  });

  it("хвостовой паддинг не меняет код", () => {
    expect(totp(`${SECRET}======`, AT)).toBe(totp(SECRET, AT));
  });

  it.each(["0", "1", "8", "9", "-"])(
    "знак %s вне алфавита отвергается",
    (bad) => {
      // Те же знаки отвергает сид: алфавит base32 — A-Z и 2-7, как у
      // `pyotp.random_base32()`. Расхождение алфавитов означало бы секрет, с
      // которым одна сторона входит, а другая — нет.
      expect(() => totp(`${SECRET.slice(0, 31)}${bad}`, AT)).toThrow(
        "Не base32",
      );
    },
  );
});
