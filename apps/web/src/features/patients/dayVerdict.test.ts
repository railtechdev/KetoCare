import { describe, expect, it } from "vitest";

import doctorRu from "../../locales/ru/doctor.json";
import homeRu from "../../locales/ru/home.json";
import menuRu from "../../locales/ru/menu.json";
import { dayVerdict, TOLERANCE_GAP_KEY } from "./dayVerdict";

describe("dayVerdict", () => {
  it("без вердикта сервера сравнивать не с чем", () => {
    expect(dayVerdict(null)).toEqual({
      ratioOffTolerance: false,
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
      kcalBelowTarget: false,
      unavailable: false,
      unavailableReason: null,
    });
  });
});

/**
 * Ключ, которого нет в словаре, i18n показывает самим ключом: на экране семьи
 * вместо объяснения появится строка «day.engineUnknown». Экран при этом не
 * падает, тест экрана тоже — поэтому полнота проверяется здесь, по списку
 * причин сервера.
 */
describe("словари объясняют каждую причину сервера", () => {
  const screens: Array<[string, Record<string, unknown>]> = [
    ["главная семьи", homeRu.day as Record<string, unknown>],
    [
      "карта пациента",
      (doctorRu.summary as { day: Record<string, unknown> }).day,
    ],
    ["меню", menuRu.totals as Record<string, unknown>],
  ];

  it.each(screens)("%s", (_name, dictionary) => {
    for (const key of Object.values(TOLERANCE_GAP_KEY)) {
      expect(typeof dictionary[key]).toBe("string");
    }
  });
});
