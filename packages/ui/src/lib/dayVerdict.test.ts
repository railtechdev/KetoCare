import { describe, expect, it } from "vitest";

import {
  dayIsOpen,
  dayVerdict,
  type DayTolerance,
  kcalToTarget,
  TOLERANCE_GAP_KEY,
  TOLERANCE_GAP_UNKNOWN_KEY,
  toleranceGapKey,
} from "./dayVerdict";

describe("dayVerdict", () => {
  it("без вердикта сервера сравнивать не с чем", () => {
    expect(dayVerdict(null)).toEqual({
      ratioOffTolerance: false,
      ratioPending: false,
      ratioUnknown: false,
      carbsOverLimit: false,
      carbsUnknown: false,
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
      {
        ratio_within_tolerance: true,
        kcal_within_tolerance: true,
        carbs_within_limit: true,
      },
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
      carbs_within_limit: true,
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
      carbs_within_limit: true,
    });

    expect(verdict.ratioOffTolerance).toBe(false);
    expect(verdict.kcalBelowTarget).toBe(true);
  });

  it("превышение лимита углеводов — предупреждение и при верном соотношении", () => {
    // Аудит расчётов 13.11.2026: день сверялся только по соотношению и
    // калорийности, и «в допуске» стояло при двойном превышении углеводов.
    const verdict = dayVerdict({
      ratio_within_tolerance: true,
      kcal_within_tolerance: true,
      carbs_within_limit: false,
    });
    expect(verdict.carbsOverLimit).toBe(true);
    expect(verdict.carbsUnknown).toBe(false);
  });

  it("ответ без поля о лимите — лимит неизвестен, а не «в норме»", () => {
    // Ответ из кеша, снятый до выката 13.11.2026.
    const stale = {
      ratio_within_tolerance: true,
      kcal_within_tolerance: true,
    } as unknown as DayTolerance;
    const verdict = dayVerdict(stale);
    expect(verdict.carbsOverLimit).toBe(false);
    expect(verdict.carbsUnknown).toBe(true);
  });

  it("день в допусках не даёт ни предупреждения, ни недобора", () => {
    expect(
      dayVerdict({
        ratio_within_tolerance: true,
        kcal_within_tolerance: true,
        carbs_within_limit: true,
      }),
    ).toEqual({
      ratioOffTolerance: false,
      ratioPending: false,
      ratioUnknown: false,
      carbsOverLimit: false,
      carbsUnknown: false,
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
      carbs_within_limit: true,
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
      carbs_within_limit: true,
    });
    const off = dayVerdict({
      ratio_within_tolerance: false,
      kcal_within_tolerance: true,
      carbs_within_limit: true,
    });

    expect(within.ratioUnknown).toBe(false);
    expect(off.ratioUnknown).toBe(false);
  });
});

describe("kcalToTarget", () => {
  it("называет остаток до суточной нормы и не уходит в минус", () => {
    // Вопрос 9: «в середине дня предупреждать, что вам надо добрать … ккал».
    // Перебор — не «добавьте −50»: о нём говорит своя строка.
    expect(kcalToTarget(401, 1200)).toBe(799);
    expect(kcalToTarget(1250, 1200)).toBe(0);
  });
});

describe("день ещё собирается (Р2 аудита Mini App)", () => {
  const off: DayTolerance = {
    ratio_within_tolerance: false,
    kcal_within_tolerance: false,
    carbs_within_limit: true,
  };

  it("сегодня, 290 из 1 200 ккал: о соотношении — спокойно, не тревогой", () => {
    const verdict = dayVerdict(off, null, {
      open: true,
      kcal: 290,
      targetKcal: 1200,
    });

    expect(verdict.ratioOffTolerance).toBe(false);
    expect(verdict.ratioPending).toBe(true);
    // Правило сервера не меняется: калорийность по-прежнему ниже нормы.
    expect(verdict.kcalBelowTarget).toBe(true);
  });

  it("лимит углеводов показывается сразу, и пока день собирается", () => {
    const verdict = dayVerdict({ ...off, carbs_within_limit: false }, null, {
      open: true,
      kcal: 290,
      targetKcal: 1200,
    });

    expect(verdict.carbsOverLimit).toBe(true);
    expect(verdict.ratioPending).toBe(true);
  });

  it("прошедший день оценивается как есть", () => {
    const verdict = dayVerdict(off, null, {
      open: false,
      kcal: 290,
      targetKcal: 1200,
    });

    expect(verdict.ratioOffTolerance).toBe(true);
    expect(verdict.ratioPending).toBe(false);
  });

  it("норма набрана — день собран, расхождение снова предупреждение", () => {
    // В допуске по калорийности: сервер считает день набранным.
    expect(
      dayVerdict({ ...off, kcal_within_tolerance: true }, null, {
        open: true,
        kcal: 1190,
        targetKcal: 1200,
      }).ratioOffTolerance,
    ).toBe(true);
    // Перебор нормы — уже не сборка.
    expect(
      dayVerdict(off, null, { open: true, kcal: 1500, targetKcal: 1200 })
        .ratioOffTolerance,
    ).toBe(true);
  });

  it("нормы не знаем — молчать о расхождении нечем оправдать", () => {
    const verdict = dayVerdict(off, null, {
      open: true,
      kcal: 290,
      targetKcal: null,
    });

    expect(verdict.ratioOffTolerance).toBe(true);
    expect(verdict.ratioPending).toBe(false);
  });

  it("без описания дня — прежний вердикт", () => {
    expect(dayVerdict(off).ratioOffTolerance).toBe(true);
    expect(dayVerdict(off).ratioPending).toBe(false);
  });

  it("соотношение в допуске — сказать «собирается» не о чем", () => {
    const verdict = dayVerdict({ ...off, ratio_within_tolerance: true }, null, {
      open: true,
      kcal: 290,
      targetKcal: 1200,
    });
    expect(verdict.ratioPending).toBe(false);
    expect(verdict.ratioOffTolerance).toBe(false);
  });
});

describe("dayIsOpen", () => {
  it("сегодня и будущие дни открыты, вчера закрыт", () => {
    expect(dayIsOpen("2026-11-21", "2026-11-21")).toBe(true);
    expect(dayIsOpen("2026-11-26", "2026-11-21")).toBe(true);
    expect(dayIsOpen("2026-11-20", "2026-11-21")).toBe(false);
  });
});
