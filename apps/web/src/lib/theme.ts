export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "ketocare-theme";
const THEMES: readonly ThemePreference[] = ["light", "dark", "system"];

/**
 * Тема оформления.
 *
 * Тёмная палитра была написана и покрыта тестом контраста, но недостижима: ни
 * один код не выставлял `data-theme`, переключателя не было, системная
 * настройка не читалась — половина токенов и все `dark:`-варианты кита лежали
 * мёртвым кодом. Для Mini App этапа 3 тёмная тема обязательна по разделу 9 ТЗ.
 *
 * Хранится в localStorage: это настройка устройства, а не учётной записи —
 * с рабочего компьютера врача и с телефона родителя ожидания разные. Доступ
 * обёрнут в try/catch: в приватном окне обращение к хранилищу бросает
 * исключение, и падать из-за выбора темы интерфейс не должен.
 */
export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && (THEMES as readonly string[]).includes(stored)) {
      return stored as ThemePreference;
    }
  } catch {
    // хранилище недоступно — работаем по системной настройке
  }
  return "system";
}

function prefersDark(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Проставляет атрибут, по которому переключаются токены темы. */
export function applyTheme(preference: ThemePreference): void {
  const dark =
    preference === "dark" || (preference === "system" && prefersDark());
  const root = document.documentElement;

  if (dark) {
    root.dataset.theme = "dark";
  } else {
    delete root.dataset.theme;
  }
  root.style.colorScheme = dark ? "dark" : "light";
}

export function storeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // выбор не сохранится до перезагрузки — это лучше, чем отказ переключения
  }
  applyTheme(preference);
}

/**
 * Применяет тему при старте и следит за сменой системной настройки.
 *
 * Вызывается до отрисовки приложения: иначе светлая тема успевает мигнуть перед
 * тёмной.
 */
export function initTheme(): void {
  applyTheme(readThemePreference());

  if (typeof matchMedia !== "function") return;
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (readThemePreference() === "system") applyTheme("system");
  });
}
