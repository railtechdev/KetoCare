import { createContext, useContext, useEffect, useRef, useState } from "react";

import {
  type BottomButtonsSpec,
  guardUnsavedInput,
  nativeBottomButtons,
  pushBottomButtons,
  refreshBottomButtons,
  showBackButton,
  showSettingsButton,
} from "./telegram";

/**
 * Видна ли вкладка, на которой стоит компонент.
 *
 * Посещённые вкладки остаются смонтированными (скрытыми), чтобы не терять
 * набранное. Но кнопка «Назад» Telegram одна на приложение: открытая карточка
 * рецепта на скрытой вкладке не должна закрываться нажатием, сделанным на
 * плане дня. Поэтому скрытая вкладка свою кнопку снимает.
 */
export const TabVisibleContext = createContext(true);

/**
 * Кнопка «Назад» Telegram, пока вложенное состояние открыто.
 *
 * `onBack` — `null`, когда закрывать нечего: тогда кнопки нет. Обработчик
 * берётся последний, но подписка не пересоздаётся на каждую отрисовку —
 * иначе кнопка мигала бы, а порядок в стопке (`showBackButton`) сбивался бы:
 * пересозданный внешний обработчик оказывался бы выше вложенного.
 */
export function useTelegramBack(onBack: (() => void) | null): void {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });
  const visible = useContext(TabVisibleContext);
  const active = onBack !== null && visible;
  useEffect(() => {
    if (!active) return undefined;
    return showBackButton(() => {
      latest.current?.();
    });
  }, [active]);
}

/** Подтверждение закрытия и запрет жеста вниз, пока ввод не сохранён. */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => (dirty ? guardUnsavedInput() : undefined), [dirty]);
}

/**
 * «Сохранить / Отмена» родными кнопками Telegram под формой (Bot API 7.10).
 *
 * Возвращает `true`, если кнопки стоят внизу Telegram — тогда экран своих не
 * рисует. `false` — вне Telegram и в старом клиенте: экран рисует обе кнопки
 * сам. `spec = null` — кнопки сейчас не нужны.
 *
 * Как у кнопки «Назад»: подписка не пересоздаётся на каждую отрисовку, а
 * скрытая вкладка свои кнопки снимает — иначе «Сохранить» формы, оставленной
 * на другой вкладке, стояла бы под чужим экраном.
 */
export function useBottomButtons(spec: BottomButtonsSpec | null): boolean {
  const [native] = useState(nativeBottomButtons);
  const latest = useRef(spec);
  const visible = useContext(TabVisibleContext);
  const active = native && spec !== null && visible;
  const release = useRef<(() => void) | null>(null);

  useEffect(() => {
    latest.current = spec;
    // Подпись и доступность меняются на каждом шаге формы.
    if (release.current !== null) refreshBottomButtons();
  });
  useEffect(() => {
    if (!active) return undefined;
    const stop = pushBottomButtons(() => latest.current);
    release.current = stop;
    return () => {
      release.current = null;
      stop();
    };
  }, [active]);
  return native;
}

/** Пункт «Настройки» в меню Telegram (Bot API 7.0), пока экраны открыты. */
export function useSettingsButton(onOpen: () => void): void {
  const latest = useRef(onOpen);
  useEffect(() => {
    latest.current = onOpen;
  });
  useEffect(
    () =>
      showSettingsButton(() => {
        latest.current();
      }),
    [],
  );
}
