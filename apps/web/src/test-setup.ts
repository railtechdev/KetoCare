import "@testing-library/jest-dom/vitest";

// Часть тестов идёт в среде node, где `window` нет вовсе.
if (typeof window !== "undefined") {
  // jsdom не умеет прокрутку, а роутер восстанавливает её при каждом переходе.
  // Без заглушки каждый тест экрана с адресуемой вкладкой сыпал бы «Not
  // implemented: window.scrollTo» — шум, за которым теряются настоящие ошибки.
  window.scrollTo = () => undefined;

  // График динамики (recharts) измеряет контейнер наблюдателем размеров,
  // которого в jsdom нет. Без заглушки экран с графиком падает в тесте целиком,
  // хотя в браузере работает.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
