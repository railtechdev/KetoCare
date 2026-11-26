import { TOLERANCE_GAP_KEY, TOLERANCE_GAP_UNKNOWN_KEY } from "@ketocare/ui";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "../../lib/i18n";
import ru from "../../locales/ru/app.json";
import { DayVerdictNote } from "./DayVerdictNote";

/**
 * Ключ, которого нет в словаре, i18n показывает самим ключом: семья увидела бы
 * строку «verdict.engineUnknown» вместо объяснения. Экран при этом не падает,
 * поэтому полнота проверяется по списку причин сервера из кита.
 */
describe("словарь Mini App объясняет каждую причину сервера", () => {
  it("для каждой причины и для её отсутствия есть текст", () => {
    const dictionary = ru.verdict as Record<string, unknown>;
    for (const key of Object.values(TOLERANCE_GAP_KEY)) {
      expect(typeof dictionary[key]).toBe("string");
    }
    expect(typeof dictionary[TOLERANCE_GAP_UNKNOWN_KEY]).toBe("string");
    expect(typeof dictionary.ratioPending).toBe("string");
  });

  it("без соотношения ни тревоги, ни похвалы", () => {
    render(
      <DayVerdictNote
        tolerance={{
          ratio_within_tolerance: null,
          kcal_within_tolerance: true,
          carbs_within_limit: true,
        }}
        gap={null}
        kcal={500}
        targetKcal={1200}
      />,
    );

    expect(
      screen.getByText(/Кетосоотношение не посчитать/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Кетосоотношение дня соответствует назначению."),
    ).not.toBeInTheDocument();
  });
});

/**
 * Р2 аудита Mini App: после первого блюда в пустом дне появлялась жёлтая
 * плашка «Меню дня расходится с назначением. Измените состав» — на 290 из
 * 1 200 ккал. Пока день открыт и норма не набрана, о соотношении — спокойно.
 */
describe("день ещё собирается", () => {
  const off = {
    ratio_within_tolerance: false,
    kcal_within_tolerance: false,
    carbs_within_limit: true,
  };

  it("сегодня, 290 из 1 200 ккал: строка вместо плашки", () => {
    render(
      <DayVerdictNote
        tolerance={off}
        gap={null}
        open
        kcal={290}
        targetKcal={1200}
      />,
    );

    expect(screen.getByText(ru.verdict.ratioPending)).toBeInTheDocument();
    expect(
      screen.queryByText(ru.verdict.offTolerance.title),
    ).not.toBeInTheDocument();
  });

  it("лимит углеводов — предупреждение сразу", () => {
    render(
      <DayVerdictNote
        tolerance={{ ...off, carbs_within_limit: false }}
        gap={null}
        open
        kcal={290}
        targetKcal={1200}
      />,
    );

    expect(screen.getByText(ru.verdict.carbsOver.title)).toBeInTheDocument();
    expect(screen.getByText(ru.verdict.ratioPending)).toBeInTheDocument();
  });

  it("день специалиста под тем же условием — тоже спокойно", () => {
    render(
      <DayVerdictNote
        tolerance={off}
        gap={null}
        open
        kcal={290}
        targetKcal={1200}
        composedBy="Анна Петровна"
      />,
    );

    expect(screen.getByText(ru.verdict.ratioPending)).toBeInTheDocument();
    expect(
      screen.queryByText(ru.verdict.bySpecialist.ratio),
    ).not.toBeInTheDocument();
  });

  it("вчерашний день — вердикт как есть", () => {
    render(
      <DayVerdictNote
        tolerance={off}
        gap={null}
        open={false}
        kcal={290}
        targetKcal={1200}
      />,
    );

    expect(screen.getByText(ru.verdict.offTolerance.title)).toBeInTheDocument();
    expect(screen.queryByText(ru.verdict.ratioPending)).not.toBeInTheDocument();
  });
});
