import "@testing-library/jest-dom/vitest";

// Часть тестов идёт в среде node, где `window` нет вовсе.
if (typeof window !== "undefined") {
  // `localStorage` в среде тестов может не существовать вовсе. На Node 20 (CI)
  // его отдаёт jsdom, на Node 26 — нет: тамошний собственный `localStorage`
  // спрятан за флагом, и до окна jsdom дело не доходит. Разница проявлялась
  // молча: два теста главной падали локально и были зелёными в CI, а всё
  // остальное просто уходило в ветку «хранилища нет».
  //
  // Заглушка ставится, только если хранилища нет: там, где оно настоящее,
  // подменять его нечем и незачем.
  if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        get length() {
          return store.size;
        },
        key: (index: number) => [...store.keys()][index] ?? null,
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) =>
          void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
      } satisfies Storage,
    });
  }

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
