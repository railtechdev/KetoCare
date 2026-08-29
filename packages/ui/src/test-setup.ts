import "@testing-library/jest-dom/vitest";

/**
 * jsdom не реализует ResizeObserver, а ResponsiveContainer из recharts на него
 * опирается. Без заглушки любой тест с графиком падает на этапе рендера —
 * при том что проверяется не размер контейнера, а содержимое.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;
