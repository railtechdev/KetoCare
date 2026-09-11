// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  KETONE_MAX_MMOL,
  OCCURRED_AT_CLOCK_SKEW_MS,
  OCCURRED_AT_FUTURE,
  KETONE_MIN_MMOL,
  WEIGHT_MAX_KG,
  WEIGHT_MIN_KG,
  ketoneBody,
  ketoneSchema,
  mealBody,
  medicationBody,
  seizureBody,
  seizureSchema,
  sideEffectBody,
  weightBody,
  weightSchema,
} from "./schemas";
import { toDateTimeLocalInput } from "./time";

const OCCURRED_AT = "2026-03-01T07:45";

/**
 * Будущего у дневника нет. Сервер отклонит такую запись сам, но ответит общим
 * «проверьте поля» — форма обязана назвать причину у поля даты.
 */
describe("момент события не в будущем", () => {
  const at = (offsetMs: number) =>
    toDateTimeLocalInput(new Date(Date.now() + offsetMs));

  it("завтра — ошибка поля даты со своей причиной", () => {
    const result = ketoneSchema.safeParse({
      occurredAt: at(24 * 60 * 60 * 1000),
      value: "2.5",
      method: "blood",
    });

    expect(result.success).toBe(false);
    const issue = result.error?.issues.find(
      (item) => item.path[0] === "occurredAt",
    );
    expect(issue?.message).toBe(OCCURRED_AT_FUTURE);
  });

  it("минута вперёд — расхождение часов, а не ошибка", () => {
    expect(
      ketoneSchema.safeParse({
        occurredAt: at(60 * 1000),
        value: "2.5",
        method: "blood",
      }).success,
    ).toBe(true);
  });

  it("допуск тот же, что у сервера, — пять минут", () => {
    // Зеркало OCCURRED_AT_CLOCK_SKEW в schemas_logs.py: разойдись они — и
    // форма пропускала бы то, что сервер отклонит без объяснения причины.
    expect(OCCURRED_AT_CLOCK_SKEW_MS).toBe(5 * 60 * 1000);
  });
});

describe("границы раздела 7.3 ТЗ", () => {
  it("кетоны принимаются на краях диапазона и отвергаются за ним", () => {
    const valid = (value: string) =>
      ketoneSchema.safeParse({
        occurredAt: OCCURRED_AT,
        value,
        method: "blood",
      }).success;

    expect(valid(String(KETONE_MIN_MMOL))).toBe(true);
    expect(valid(String(KETONE_MAX_MMOL))).toBe(true);
    expect(valid("12.1")).toBe(false);
    expect(valid("-0.1")).toBe(false);
    expect(valid("")).toBe(false);
  });

  it("вес принимается на краях диапазона и отвергается за ним", () => {
    const valid = (weightKg: string) =>
      weightSchema.safeParse({
        occurredAt: OCCURRED_AT,
        weightKg,
        heightCm: "",
      }).success;

    expect(valid(String(WEIGHT_MIN_KG))).toBe(true);
    expect(valid(String(WEIGHT_MAX_KG))).toBe(true);
    expect(valid("1.9")).toBe(false);
    expect(valid("150.1")).toBe(false);
  });
});

describe("проверки формы приступа", () => {
  const values = {
    occurredAt: OCCURRED_AT,
    seizureTypeId: "type-1",
    durationSec: "",
    durationOptionId: "",
    count: "1",
    description: "",
    triggers: "",
  };

  it("длительность — либо секунды, либо интервал, но не оба", () => {
    // Два ответа об одной величине однажды разойдутся, и какой из них правда —
    // по записи уже не установить (ADR-0020). Сервер проверяет то же самое;
    // здесь — чтобы человек узнал до отправки.
    expect(
      seizureSchema.safeParse({ ...values, durationSec: "90" }).success,
    ).toBe(true);
    expect(
      seizureSchema.safeParse({ ...values, durationOptionId: "opt-1" }).success,
    ).toBe(true);
    expect(
      seizureSchema.safeParse({
        ...values,
        durationSec: "90",
        durationOptionId: "opt-1",
      }).success,
    ).toBe(false);
  });

  it("требует тип приступа", () => {
    expect(
      seizureSchema.safeParse({ ...values, seizureTypeId: "" }).success,
    ).toBe(false);
  });

  it("число приступов — целое, не меньше одного", () => {
    expect(seizureSchema.safeParse({ ...values, count: "0" }).success).toBe(
      false,
    );
    expect(seizureSchema.safeParse({ ...values, count: "1.5" }).success).toBe(
      false,
    );
    expect(seizureSchema.safeParse({ ...values, count: "2" }).success).toBe(
      true,
    );
  });

  it("длительность необязательна, но целая", () => {
    expect(
      seizureSchema.safeParse({ ...values, durationSec: "" }).success,
    ).toBe(true);
    expect(
      seizureSchema.safeParse({ ...values, durationSec: "45" }).success,
    ).toBe(true);
    expect(
      seizureSchema.safeParse({ ...values, durationSec: "45.5" }).success,
    ).toBe(false);
  });
});

describe("тело запроса", () => {
  it("момент события уходит со смещением и в местном времени", () => {
    const body = ketoneBody({
      occurredAt: OCCURRED_AT,
      value: "3.4",
      method: "blood",
    });

    expect(body).not.toBeNull();
    expect(body!.kind).toBe("ketones");
    expect(toDateTimeLocalInput(new Date(body!.body.occurred_at))).toBe(
      OCCURRED_AT,
    );
    expect(body!.body.occurred_at).toMatch(/Z$|[+-]\d{2}:\d{2}$/);
  });

  it("кетоны и метод переносятся числом и кодом", () => {
    const body = ketoneBody({
      occurredAt: OCCURRED_AT,
      value: "3.4",
      method: "urine",
    });

    expect(body?.body).toMatchObject({ value: 3.4, method: "urine" });
  });

  it("пустое необязательное число становится null, а не нулём", () => {
    const weight = weightBody({
      occurredAt: OCCURRED_AT,
      weightKg: "18.6",
      heightCm: "",
    });
    expect(weight?.body).toMatchObject({ weight_kg: 18.6, height_cm: null });

    const seizure = seizureBody({
      occurredAt: OCCURRED_AT,
      seizureTypeId: "type-1",
      durationSec: "",
      durationOptionId: "",
      count: "2",
      description: "  ",
      triggers: "",
    });
    expect(seizure?.body).toMatchObject({
      seizure_type_id: "type-1",
      duration_sec: null,
      count: 2,
      description: null,
      triggers: null,
    });
  });

  it("текст обрезается по краям", () => {
    expect(
      mealBody({ occurredAt: OCCURRED_AT, freeText: "  омлет  " })?.body,
    ).toMatchObject({ free_text: "омлет" });

    expect(
      sideEffectBody({
        occurredAt: OCCURRED_AT,
        symptom: " сонливость ",
        description: " весь день ",
      })?.body,
    ).toMatchObject({ symptom: "сонливость", description: "весь день" });
  });

  it("отметка о приёме препарата сохраняет булево значение", () => {
    expect(
      medicationBody({
        occurredAt: OCCURRED_AT,
        medicationId: "med-1",
        taken: false,
      })?.body,
    ).toMatchObject({ medication_id: "med-1", taken: false });
  });

  it("не собирает тело при неразобранном моменте события", () => {
    expect(
      ketoneBody({ occurredAt: "", value: "3.4", method: "blood" }),
    ).toBeNull();
  });
});
