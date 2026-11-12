import { useRef, useState } from "react";

import { useAddToMenuMutation, type DishKind } from "./useMenu";

/** Блюдо, которое ставят в меню: рецепт базы или блюдо ребёнка. */
export interface MenuDish {
  kind: DishKind;
  id: string;
  title: string;
}

/** Куда в меню: день и номер приёма (ADR-0029). */
export interface MenuSlot {
  date: string;
  mealIndex: number;
}

export function slotKey(dishId: string, slot: MenuSlot): string {
  return `${dishId}|${slot.date}|${slot.mealIndex}`;
}

/**
 * Поставить блюдо в меню — одна дорога на все места, откуда его ставят:
 * калькулятор после сохранения, список блюд ребёнка, подбор на остаток дня.
 *
 * Двойное нажатие не ставит блюдо дважды. `isPending` для этого мало: между
 * двумя нажатиями в одном такте экран ещё не перерисован, и второе уходило
 * вторым запросом — в день вставали две одинаковые позиции. Защёлка в `ref`
 * снимается только с ответом. А то, что уже поставлено в этот день и приём,
 * помнится (`added`): повторное нажатие после ответа — тоже не новое желание, а
 * та же попытка, и кнопка говорит, что блюдо уже там.
 */
export function useAddToMenu(patientId: string) {
  const mutation = useAddToMenuMutation(patientId);
  const busy = useRef(false);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());

  async function add(dish: MenuDish, slot: MenuSlot): Promise<boolean> {
    const key = slotKey(dish.id, slot);
    if (busy.current || added.has(key)) return false;
    busy.current = true;
    try {
      await mutation.mutateAsync({
        date: slot.date,
        mealIndex: slot.mealIndex,
        kind: dish.kind,
        id: dish.id,
        portionFactor: 1,
      });
      setAdded((current) => new Set(current).add(key));
      return true;
    } catch {
      // Отказ показывает `error` рядом с кнопкой.
      return false;
    } finally {
      busy.current = false;
    }
  }

  return {
    add,
    isAdded: (dishId: string, slot: MenuSlot) =>
      added.has(slotKey(dishId, slot)),
    pending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}
