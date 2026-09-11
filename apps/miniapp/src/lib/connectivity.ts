import { onlineManager } from "@tanstack/react-query";

import { webApp } from "./telegram";

/**
 * Источник «есть ли сеть» для TanStack Query внутри Telegram.
 *
 * `onlineManager` стартует с «в сети» и меняет состояние только по событиям
 * окна `online` и `offline`. Во встроенном WebView Telegram после свёрнутого
 * приложения или смены сети `online` может не прийти вовсе: запросы остаются
 * на паузе (`fetchStatus: "paused"`), и экран бесконечно показывает загрузку
 * при живой связи. Поэтому состояние перепроверяется по `navigator.onLine`
 * там, где человек возвращается к приложению: на `visibilitychange` и на
 * событии Telegram `activated` (Bot API 8.0: «Mini App becomes active, e.g.
 * opened from minimized state»). Способ подмены — `setEventListener`, так
 * TanStack Query предлагает подключать свой источник сети (документация
 * `onlineManager`). Решение — ADR-0036.
 *
 * `navigator.onLine === true` связи не гарантирует, но цена ошибки мала:
 * запрос уйдёт и откажет «нет связи» (ADR-0034), а не повиснет молча.
 */
export function connectivityListener(
  setOnline: (online: boolean) => void,
): () => void {
  const recheck = () => {
    setOnline(navigator.onLine);
  };
  const online = () => {
    setOnline(true);
  };
  const offline = () => {
    setOnline(false);
  };

  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  document.addEventListener("visibilitychange", recheck);
  const telegram = webApp();
  telegram?.onEvent("activated", recheck);
  // Query стартует с «в сети», не спрашивая браузер: открытое без сети
  // приложение иначе считало бы себя подключённым до первого события.
  recheck();

  return () => {
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
    document.removeEventListener("visibilitychange", recheck);
    telegram?.offEvent("activated", recheck);
  };
}

/** Подключает `connectivityListener` к общему `onlineManager`. */
export function watchConnectivity(): void {
  onlineManager.setEventListener(connectivityListener);
}
