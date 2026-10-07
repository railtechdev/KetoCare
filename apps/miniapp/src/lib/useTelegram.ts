import { createContext, useContext, useEffect, useRef } from "react";

import { guardUnsavedInput, showBackButton } from "./telegram";

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
