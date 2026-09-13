import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Учётные данные сквозного прогона объявлены трижды: в `.env.example`, в сиде
 * (`infra/scripts/seed_e2e.py`) и в самом прогоне (`apps/e2e/src/env.ts`).
 *
 * Три копии одного значения расходятся молча. Для секрета второго фактора цена
 * этому — отказ входа врача, по которому причину не найти: в базе одно
 * значение, в тесте другое, сервер отвечает 401. Ровно от этого класса и
 * уходили, делая секрет детерминированным.
 *
 * Тест стоит в кабинете, а не в прогоне: у `apps/e2e` нет vitest вовсе
 * (только Playwright), а ночной прогон идёт раз в сутки — этот падает сразу.
 * Тот же приём применён к моделям ИИ в `apps/worker/tests/test_ai_client.py`.
 */
const ROOT = join(import.meta.dirname, "..", "..", "..");

function fromEnvExample(name: string): string | undefined {
  const source = readFileSync(join(ROOT, ".env.example"), "utf8");
  const line = source
    .split("\n")
    .find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim();
}

function fromSeed(name: string): string | undefined {
  const source = readFileSync(
    join(ROOT, "infra", "scripts", "seed_e2e.py"),
    "utf8",
  );
  return new RegExp(`os\\.environ\\.get\\("${name}", "([^"]+)"\\)`).exec(
    source,
  )?.[1];
}

function fromRun(name: string): string | undefined {
  const source = readFileSync(
    join(ROOT, "apps", "e2e", "src", "env.ts"),
    "utf8",
  );
  return new RegExp(`value\\(\\s*"${name}",\\s*"([^"]+)"`).exec(source)?.[1];
}

describe("учётные данные сквозного прогона", () => {
  it.each(["E2E_PASSWORD", "E2E_TOTP_SECRET"])(
    "%s объявлен одинаково в .env.example, сиде и прогоне",
    (name) => {
      const example = fromEnvExample(name);
      const seed = fromSeed(name);
      const run = fromRun(name);

      expect(example, `${name} пропал из .env.example`).toBeDefined();
      expect(seed, `${name} пропал из сида`).toBeDefined();
      expect(run, `${name} пропал из прогона`).toBeDefined();
      expect(seed).toBe(example);
      expect(run).toBe(example);
    },
  );

  it("секрет второго фактора — base32, как у сервера", () => {
    // `pyotp.random_base32()` и разбор в `apps/e2e/src/totp.ts` знают только
    // A-Z и 2-7: значение с другими знаками сломает подсчёт кода.
    expect(fromEnvExample("E2E_TOTP_SECRET")).toMatch(/^[A-Z2-7]{16,}$/);
  });
});
