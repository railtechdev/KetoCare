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
  strictMonitoring: false,
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

/**
 * Какую пометку какими словами зовут. Пары названы здесь ЯВНО и независимо от
 * кода: сам код берёт подпись из общей таблицы, поэтому перестановка двух её
 * записей целиком осталась бы согласованной — и строка, и легенда сказали бы
 * одно и то же неверное слово. Значок и цвет тут не помогут: у «стало больше» и
 * «возобновились» они одинаковые.
 */
const EXPECTED_LABEL: Record<string, string> = {
  "no-prescription": doctorRu.flags.noPrescription,
  "seizures-grew": doctorRu.flags.seizuresGrew,
  "seizures-appeared": doctorRu.flags.seizuresAppeared,
  stale: doctorRu.flags.legend.noReadingsTerm,
  nutrition: doctorRu.flags.nutritionOff,
};

describe("пометки строки и легенда говорят одно и то же", () => {
  it("каждая пометка называется своими словами", async () => {
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
      const legend = document.querySelector(`[data-legend="${key}"]`);
      expect(legend?.textContent, `подпись ${key}`).toBe(EXPECTED_LABEL[key]);
    }
  });

  it("у каждой пометки в легенде тот же значок, цвет и текст", async () => {
    // Легенда и строка писались двумя рукописными списками и разошлись при
    // первом же добавлении пометки: «Приступов стало больше» получило в легенде
    // оранжевый треугольник вместо красного пульса, две записи остались без
    // значка вовсе, а «Кетосоотношение вне допуска» свой значок потеряло. Врач
    // ищет в легенде ровно то, что видит в строке, — значит расхождение это
    // дефект, а не косметика (правило П19 канона, WCAG 1.4.1).
    //
    // Текст сверяется наравне со значком, и для приступных пометок он ВАЖНЕЕ:
    // значок и цвет у «стало больше» и «возобновились» одинаковые, и различает
    // их только подпись. Поменяй подписи местами — проверка значков молчала бы,
    // а врач читал бы «Приступы возобновились» у ребёнка, у которого их стало
    // больше.
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

      const inRow = (badge as Element).textContent ?? "";
      const inLegend = (legend as Element).textContent ?? "";
      if (key === "stale") {
        // Единственная пометка, где подписи РАЗНЫЕ по замыслу: в строке стоит
        // срок молчания («Нет замеров: 5 дн.»), в легенде — безусловный термин.
        // Требуется, чтобы строка начиналась с него, иначе врач не свяжет одно
        // с другим.
        expect(inRow.startsWith(inLegend), `подпись ${key}`).toBe(true);
      } else {
        expect(inLegend, `подпись ${key}`).toBe(inRow);
      }
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
      strictMonitoring: false,
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

  it("в первый месяц терапии пометка молчания говорит, почему она раньше", () => {
    // Порог в этот месяц короче обычного, и «Нет замеров: 2 дн.» рядом с
    // легендой про трое суток читалось бы как ошибка кабинета.
    render(
      <PatientFlagsView
        flags={{
          noPrescription: false,
          daysSinceLastReading: 2,
          strictMonitoring: true,
          staleData: true,
          nutritionOff: false,
          seizuresGrew: false,
          seizuresAppeared: false,
        }}
      />,
    );

    expect(document.querySelector('[data-flag="stale"]')).toHaveTextContent(
      /первый месяц терапии/,
    );
  });

  it("легенда называет оба порога", async () => {
    const user = userEvent.setup();
    render(<PatientFlagsLegend />);
    await user.click(
      screen.getByRole("button", { name: doctorRu.flags.legend.open }),
    );

    const stale = document.querySelector(
      '[data-legend="stale"]',
    )?.nextElementSibling;
    expect(stale).toHaveTextContent(/3 и более дня назад/);
    expect(stale).toHaveTextContent(/первый месяц терапии/);
    expect(stale).toHaveTextContent(/2 и более дня назад/);
  });

  it("спокойная строка называет давность данных, а не молчит", () => {
    render(
      <PatientFlagsView
        flags={{
          noPrescription: false,
          daysSinceLastReading: 0,
          strictMonitoring: false,
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
