// @vitest-environment node
import { describe, expect, it } from "vitest";

import { forbiddenTermsIn } from "@ketocare/ui/testing";

import ru from "./ru/app.json";
import uz from "./uz/app.json";

/**
 * Один словарь терминов на четыре канала (docs/PLAN_UI_TEXT_2026-11.md, раздел 3).
 *
 * Список запрещённых слов общий с кабинетом, ботом и сообщениями воркера: семья
 * видит все четыре канала, и одно и то же не должно называться в них по-разному
 * («план дня» в приложении, «меню» в кабинете) или словами разработки.
 */
describe("словари Mini App", () => {
  it("не используют запрещённых слов", () => {
    expect([
      ...forbiddenTermsIn("ru/app.json", ru),
      ...forbiddenTermsIn("uz/app.json", uz),
    ]).toEqual([]);
  });
});
