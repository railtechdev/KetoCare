import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import i18n from "../../lib/i18n";
import doctorRu from "../../locales/ru/doctor.json";
import {
  FLAG_KEYS,
  PatientFlagsLegend,
  PatientFlagsView,
} from "./PatientFlagsView";
import { attentionRank, type PatientFlags } from "./flags";

// Пространство имён экрана подключает координатор (`lib/i18n.ts`), поэтому
// тест регистрирует словарь сам: иначе проверялись бы ключи, а не текст.
i18n.addResourceBundle("ru", "doctor", doctorRu, true, true);

/** Пациент, у которого горит всё сразу: так видно порядок и полный набор. */
const EVERYTHING: PatientFlags = {
  noPrescription: true,
  daysSinceLastReading: 5,
  staleData: true,
  nutritionOff: true,
  seizuresGrew: true,
  seizuresAppeared: true,
};

/** Значок lucide подписывает себя классом `lucide-<имя>`. */
function iconOf(element: Element): string {
  const svg = element.querySelector("svg");
  if (svg === null) return "";
  return (
    Array.from(svg.classList).find((name) => name.startsWith("lucide-")) ?? ""
  );
}

/** Цветовой токен: у плашки он в фоне, у значка легенды — в тексте. */
function toneOf(element: Element, from: "badge" | "legendIcon"): string {
  const target =
    from === "badge" ? element : (element.querySelector("svg") ?? element);
  return (
    Array.from(target.classList).find(
      (name) => name.endsWith("destructive") || name.endsWith("warning"),
    ) ?? ""
  );
}

const TONE_PAIRS: Record<string, string> = {
  "bg-destructive": "text-destructive",
  "bg-warning": "text-warning",
};

describe("пометки строки и легенда говорят одно и то же", () => {
  it("у каждой пометки в легенде тот же значок и тот же цвет", async () => {
    // Легенда и строка писались двумя рукописными списками и разошлись при
    // первом же добавлении пометки: «Приступов стало больше» получило в легенде
    // оранжевый треугольник вместо красного пульса, две записи остались без
    // значка вовсе, а «Кетосоотношение вне допуска» свой значок потеряло. Врач
    // ищет в легенде ровно то, что видит в строке, — значит расхождение это
    // дефект, а не косметика (правило П19 канона, WCAG 1.4.1).
    const user = userEvent.setup();
    render(
      <>
        <PatientFlagsView flags={EVERYTHING} />
        <PatientFlagsLegend />
      </>,
    );
    await user.click(
      screen.getByRole("button", { name: doctorRu.flags.legend.open }),
    );

    for (const key of FLAG_KEYS) {
      const badge = document.querySelector(`[data-flag="${key}"]`);
      const legend = document.querySelector(`[data-legend="${key}"]`);
      expect(badge, `пометка ${key} не показана в строке`).not.toBeNull();
      expect(legend, `пометка ${key} не объяснена в легенде`).not.toBeNull();

      expect(iconOf(legend as Element), `значок ${key}`).toBe(
        iconOf(badge as Element),
      );
      expect(TONE_PAIRS[toneOf(badge as Element, "badge")], `цвет ${key}`).toBe(
        toneOf(legend as Element, "legendIcon"),
      );
    }
  });

  it("порядок пометок в строке совпадает с порядком по вниманию", async () => {
    // Список сортируется по `attentionRank`, и глаз обязан читать пометки в том
    // же порядке, в каком они двигают строку вверх. Разойдись они — врач видел
    // бы «нет замеров» первой строкой у пациента, которого наверх подняли
    // выросшие приступы.
    render(<PatientFlagsView flags={EVERYTHING} />);

    const shown = Array.from(
      document.querySelectorAll("[data-flag]"),
      (node) => node.getAttribute("data-flag") ?? "",
    );

    // Вес считается ровно для той пометки, которая стоит в строке на этом
    // месте, — иначе проверка сравнивала бы порядок сама с собой и пережила бы
    // любую перестановку.
    const QUIET: PatientFlags = {
      noPrescription: false,
      daysSinceLastReading: 0,
      staleData: false,
      nutritionOff: false,
      seizuresGrew: false,
      seizuresAppeared: false,
    };
    const ONLY: Record<string, PatientFlags> = {
      "no-prescription": { ...QUIET, noPrescription: true },
      "seizures-grew": { ...QUIET, seizuresGrew: true },
      "seizures-appeared": { ...QUIET, seizuresAppeared: true },
      stale: { ...QUIET, staleData: true },
      nutrition: { ...QUIET, nutritionOff: true },
    };
    const weights = shown.map((key) => attentionRank(ONLY[key] ?? QUIET));

    expect(shown).toHaveLength(FLAG_KEYS.length);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
  });

  it("спокойная строка называет давность данных, а не молчит", () => {
    render(
      <PatientFlagsView
        flags={{
          noPrescription: false,
          daysSinceLastReading: 0,
          staleData: false,
          nutritionOff: false,
          seizuresGrew: false,
          seizuresAppeared: false,
        }}
      />,
    );

    expect(document.querySelectorAll("[data-flag]")).toHaveLength(0);
    expect(screen.getByText(/Без замечаний/)).toBeInTheDocument();
  });

  it("неполученная сводка — состояние, а не «замечаний нет»", () => {
    // Триаж, выдающий «всё хорошо» там, где ничего не известно, — худшая из
    // его возможных ошибок.
    render(<PatientFlagsView flags={null} />);

    expect(screen.getByText(doctorRu.flags.unknown)).toBeInTheDocument();
    expect(screen.queryByText(/Без замечаний/)).not.toBeInTheDocument();
  });
});
