import { describe, expect, it } from "vitest";

import {
  dayVerdict,
  TOLERANCE_GAP_KEY,
  TOLERANCE_GAP_UNKNOWN_KEY,
  toleranceGapKey,
} from "./dayVerdict";

describe("dayVerdict", () => {
  it("без вердикта сервера сравнивать не с чем", () => {
    expect(dayVerdict(null)).toEqual({
      ratioOffTolerance: false,
      ratioUnknown: false,
      kcalBelowTarget: false,
      unavailable: true,
      unavailableReason: null,
    });
    expect(dayVerdict(undefined).unavailable).toBe(true);
  });

  it("причина отсутствия вердикта берётся у сервера, а не угадывается", () => {
    // Причин две, и экран говорит о них разное. Пока текст был один, кабинет
    // объяснял смену версии ядра как «активного назначения нет» — при живом
    // назначении. Догадаться на клиенте нечем: сегодняшнюю версию ядра знает
    // только сервер.
    expect(dayVerdict(null, "no_prescription").unavailableReason).toBe(
      "no_prescription",
    );
    expect(dayVerdict(null, "engine_changed").unavailableReason).toBe(
      "engine_changed",
    );
  });

  it("при живом вердикте причины нет", () => {
    // Иначе экран однажды покажет и вердикт, и объяснение, почему его нет.
    const verdict = dayVerdict(
      { ratio_within_tolerance: true, kcal_within_tolerance: true },
      "engine_changed",
    );

    expect(verdict.unavailable).toBe(false);
    expect(verdict.unavailableReason).toBeNull();
  });

  it("расхождение кетосоотношения — предупреждение в любой момент дня", () => {
    // Соотношение обязано держаться в каждом приёме пищи, поэтому его выход за
    // допуск верен и на половине дня.
    const verdict = dayVerdict({
      ratio_within_tolerance: false,
      kcal_within_tolerance: true,
    });

    expect(verdict.ratioOffTolerance).toBe(true);
    expect(verdict.kcalBelowTarget).toBe(false);
  });

  it("недобор калорий не выдаётся за расхождение", () => {
    // Сервер сравнивает набранное с СУТОЧНОЙ нормой, а признака «день
    // спланирован до конца» нет. Показать это предупреждением значит зажечь его
    // навсегда — и приучить не читать предупреждения вообще.
    const verdict = dayVerdict({
      ratio_within_tolerance: true,
      kcal_within_tolerance: false,
    });

    expect(verdict.ratioOffTolerance).toBe(false);
    expect(verdict.kcalBelowTarget).toBe(true);
  });

  it("день в допусках не даёт ни предупреждения, ни недобора", () => {
    expect(
      dayVerdict({ ratio_within_tolerance: true, kcal_within_tolerance: true }),
    ).toEqual({
      ratioOffTolerance: false,
      ratioUnknown: false,
      kcalBelowTarget: false,
      unavailable: false,
      unavailableReason: null,
    });
  });
});

/**
 * Полнота словарей проверяется в каждом приложении по его словарям (кабинет —
 * `features/patients/dayVerdictDictionaries.test.ts`, Mini App —
 * `features/menu/DayVerdictNote.test.tsx`): кит словарей не держит.
 */
describe("причина отсутствия вердикта и неизвестное соотношение", () => {
  it("у каждой причины сервера свой ключ", () => {
    const keys = Object.values(TOLERANCE_GAP_KEY);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain(TOLERANCE_GAP_UNKNOWN_KEY);
  });

  it("без причины берётся нейтральный текст, а не вероятная причина", () => {
    // Подставить сюда «назначения нет» — вернуть ровно тот дефект, ради
    // которого причина и заводилась. Причина пропадает не в теории: ответ из
    // кеша, снятый до выката, приходит без поля вовсе.
    expect(toleranceGapKey(null)).toBe(TOLERANCE_GAP_UNKNOWN_KEY);
    expect(toleranceGapKey(null)).not.toBe(TOLERANCE_GAP_KEY.no_prescription);
    expect(toleranceGapKey("engine_changed")).toBe(
      TOLERANCE_GAP_KEY.engine_changed,
    );
  });

  it("без соотношения предупреждения нет", () => {
    // `null` — соотношения у дня нет (ADR-0037), и это не отклонение: прежде
    // оно схлопывалось в «вне допуска» и попадало в предупреждения семье.
    const verdict = dayVerdict({
      ratio_within_tolerance: null,
      kcal_within_tolerance: true,
    });

    expect(verdict.ratioOffTolerance).toBe(false);
    expect(verdict.unavailable).toBe(false);
    // И отдельным признаком: «сказать нечего» — не то же, что «всё хорошо».
    expect(verdict.ratioUnknown).toBe(true);
  });

  it("живой вердикт не считается неизвестным", () => {
    const within = dayVerdict({
      ratio_within_tolerance: true,
      kcal_within_tolerance: true,
    });
    const off = dayVerdict({
      ratio_within_tolerance: false,
      kcal_within_tolerance: true,
    });

    expect(within.ratioUnknown).toBe(false);
    expect(off.ratioUnknown).toBe(false);
  });
});
