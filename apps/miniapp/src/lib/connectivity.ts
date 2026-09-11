import { onlineManager } from "@tanstack/react-query";

import { webApp } from "./telegram";

/**
 * Источник «есть ли сеть» для TanStack Query внутри Telegram.
 *
 * `onlineManager` стартует с «в сети» и меняет состояние только по событиям
 * окна `online` и `offline`. Запросы в режиме `networkMode: "online"` без сети
 * встают на паузу (`fetchStatus: "paused"`) и ждут `online`. Во встроенном
 * WebView Telegram это событие может не прийти после свёрнутого приложения или
 * смены сети — тогда экран показывает пустоту при живой связи, пока приложение
 * не перезапустят. Способ подмены — `setEventListener`, так TanStack Query
 * предлагает подключать свой источник сети. Решение — ADR-0036.
 *
 * **Перепроверка односторонняя.** `visibilitychange` и `activated` могут
 * вернуть состояние в «сеть есть», но не в «сети нет»: `navigator.onLine`
 * бывает ложно отрицательным, и доверие ему вниз создало бы ровно тот отказ,
 * который здесь чинится, — запросы на паузе при живой связи. Вниз состояние
 * двигает только событие `offline` самого браузера, как и раньше.
 */
export function connectivityListener(
  setOnline: (online: boolean) => void,
): () => void {
  const recheck = () => {
    if (navigator.onLine) setOnline(true);
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
