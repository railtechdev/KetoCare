/**
 * Не догрузилась часть приложения — экран раздела, пришедший отдельным файлом.
 *
 * Два обычных повода. После выката у файлов новые имена, а вкладка, открытая
 * до него, просит старые — сервер их уже не отдаёт. Без сети файл не
 * приходит вовсе. Маршрутизатор в обоих случаях показывал свою английскую
 * заглушку «Something went wrong!» без единой ссылки.
 *
 * Первый случай лечится одной перезагрузкой: страница возьмёт новые имена.
 * Перезагрузка — РОВНО одна: если и после неё файл не пришёл (нет сети), цикл
 * перезагрузок съел бы вкладку, поэтому второй раз за минуту экран уже
 * объясняет словами и даёт кнопку.
 */
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk [\w-]+ failed/i;

const RELOADED_AT_KEY = "kc.chunkReloadAt";

/** Окно, в котором вторая перезагрузка не делается. */
const RELOAD_GUARD_MS = 60_000;

export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  return CHUNK_ERROR.test(message);
}

interface Storage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * Перезагрузить страницу, если это отказ загрузки части приложения и за
 * последнюю минуту перезагрузки не было. Возвращает `true`, если перезагрузка
 * запущена — экрану показывать нечего.
 */
export function reloadOnceForChunkError(
  error: unknown,
  storage: Storage | null,
  reload: () => void,
  now: number = Date.now(),
): boolean {
  if (!isChunkLoadError(error) || storage === null) return false;
  let last = Number.NaN;
  try {
    const stored = storage.getItem(RELOADED_AT_KEY);
    if (stored !== null) last = Number(stored);
  } catch {
    return false;
  }
  if (Number.isFinite(last) && now - last < RELOAD_GUARD_MS) return false;
  try {
    storage.setItem(RELOADED_AT_KEY, String(now));
  } catch {
    // Без памяти о прошлой перезагрузке цикл не остановить — не начинаем.
    return false;
  }
  reload();
  return true;
}

/** `sessionStorage`, если он доступен (в приватном окне бывает, что нет). */
export function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
