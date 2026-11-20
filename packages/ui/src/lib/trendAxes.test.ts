import { describe, expect, it } from "vitest";

import {
  MARKER_LABEL_ROOM,
  MARKER_LABEL_ROWS,
  MARKER_ROW_STEP,
  PHONE_PLOT_WIDTH,
  chartMargin,
  markerLabelRows,
  markerLabelWidth,
  dayAxis,
  startOfLocalDay,
  valueDomain,
} from "./trendAxes";

describe("ось значений", () => {
  it("единственное значение не ложится на край", () => {
    // Верх оси был равен значению, и точка срезалась наполовину.
    const [lower, upper] = valueDomain([2.7]);
    expect(upper).toBeGreaterThan(2.7);
    expect(lower).toBeLessThan(2.7);
    expect(lower).toBeGreaterThanOrEqual(0);
  });

  it("запас — доля размаха, и ниже нуля ось не уходит", () => {
    expect(valueDomain([0.2, 2.2])).toEqual([0, 2.5]);
    expect(valueDomain([18, 20])).toEqual([17.7, 20.3]);
  });
});

describe("ось дней", () => {
  it("два замера одного дня — одна подпись, а не «07.10 07.10»", () => {
    const morning = new Date(2026, 9, 7, 8, 0).getTime();
    const evening = new Date(2026, 9, 7, 21, 0).getTime();

    const axis = dayAxis([morning, evening]);

    expect(axis.ticks).toEqual([startOfLocalDay(morning)]);
    expect(axis.domain[0]).toBeLessThanOrEqual(morning);
    expect(axis.domain[1]).toBeGreaterThan(evening);
  });

  it("месяц — не больше шести подписей, каждая на своём дне", () => {
    const first = new Date(2026, 8, 7, 9, 0).getTime();
    const last = new Date(2026, 9, 6, 9, 0).getTime();

    const { ticks } = dayAxis([first, last]);

    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(
      new Set(ticks.map((tick) => new Date(tick).toDateString())).size,
    ).toBe(ticks.length);
    for (const tick of ticks) expect(startOfLocalDay(tick)).toBe(tick);
  });
});

describe("chartMargin", () => {
  it("даёт подписям черт смены назначения место сверху (Д5)", () => {
    // Подпись шрифтом 11 px стоит над областью построения: при поле 8 px
    // её верх срезался.
    expect(chartMargin(1).top).toBe(MARKER_LABEL_ROOM);
    expect(MARKER_LABEL_ROOM).toBeGreaterThanOrEqual(20);
  });

  it("второй ряд подписей получает свою строку сверху", () => {
    expect(chartMargin(2).top).toBe(MARKER_LABEL_ROOM + MARKER_ROW_STEP);
  });

  it("без черт не отнимает высоту у графика", () => {
    expect(chartMargin(0)).toEqual({
      top: 8,
      right: 8,
      bottom: 8,
      left: 0,
    });
  });
});

describe("markerLabelRows", () => {
  const DAY = 86_400_000;
  const start = new Date(2026, 9, 1).getTime();
  const month: [number, number] = [start, start + 30 * DAY];
  const at = (day: number, label: string) => ({ ts: start + day * DAY, label });

  /** Подписи одного ряда не перекрываются — в пикселях той же оценки. */
  function overlapsInRow(
    markers: { ts: number; label: string }[],
    rows: (number | null)[],
    width: number,
  ): boolean {
    const boxes = markers
      .map((marker, index) => {
        const x = ((marker.ts - month[0]) / (month[1] - month[0])) * width;
        const half = markerLabelWidth(marker.label) / 2;
        return { row: rows[index], left: x - half, right: x + half };
      })
      .filter((box) => box.row !== null);
    return boxes.some((a, i) =>
      boxes.some(
        (b, j) =>
          i < j && a.row === b.row && a.left < b.right && b.left < a.right,
      ),
    );
  }

  it("далёкие черты подписаны в один ряд", () => {
    const markers = [at(2, "2:1"), at(15, "3:1"), at(28, "4:1")];
    expect(markerLabelRows(markers, month)).toEqual([0, 0, 0]);
  });

  it("ввод диеты через день: соседние подписи расходятся по рядам (Д5)", () => {
    // Прежде все три стояли в одном ряду и читались «3.53.53.5:1».
    const markers = [at(10, "2.5:1"), at(12, "3:1"), at(14, "3.5:1")];
    const rows = markerLabelRows(markers, month);
    expect(rows[2]).toBe(0); // действующее — внизу и всегда подписано
    expect(rows[1]).toBe(1);
    expect(overlapsInRow(markers, rows, PHONE_PLOT_WIDTH)).toBe(false);
  });

  it("не уместившиеся в два ряда остаются чертой без подписи", () => {
    const markers = [
      at(10, "1:1"),
      at(10.5, "2:1"),
      at(11, "3:1"),
      at(11.5, "4:1"),
    ];
    const rows = markerLabelRows(markers, month);
    expect(rows[3]).toBe(0);
    expect(rows.filter((row) => row !== null).length).toBeLessThanOrEqual(
      MARKER_LABEL_ROWS,
    );
    expect(overlapsInRow(markers, rows, PHONE_PLOT_WIDTH)).toBe(false);
  });

  it("на широком графике те же черты помещаются в один ряд", () => {
    const markers = [at(10, "2.5:1"), at(12, "3:1"), at(14, "3.5:1")];
    expect(markerLabelRows(markers, month, 1000)).toEqual([0, 0, 0]);
  });

  it("черта вне оси времени не подписывается", () => {
    expect(markerLabelRows([at(-5, "2:1"), at(5, "3:1")], month)).toEqual([
      null,
      0,
    ]);
  });
});
