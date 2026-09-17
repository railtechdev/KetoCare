import type { Menu, MenuItem } from "./useMenu";

/** Позиция в том виде, в каком её принимает `PUT /patients/{id}/menus`. */
export interface DayItem {
  meal_index: number;
  recipe_id: string | null;
  custom_dish_id: string | null;
  portion_factor: number;
}

/**
 * Состав дня для сохранения.
 *
 * **День сохраняется целиком** (раздел 5.3 ТЗ): `PUT` задаёт весь состав, а не
 * добавляет позицию. Отсюда главное правило этого модуля — существующие позиции
 * обязаны уезжать обратно без искажений.
 *
 * Цена ошибки не в пропавшей строке, и ошибок тут две разного рода.
 *
 * Ключ переиспользования на сервере — `(meal_index, recipe_id, custom_dish_id)`
 * (`core/repositories/menus.py::replace_items`). Сдвинули номер приёма или
 * переложили `recipe_id` в `custom_dish_id` — сервер считает позицию другой:
 * старую мягко удалит, новую заведёт с `eaten = false`, а записи дневника еды
 * останутся ссылаться на удалённую. Семья, добавившая ужин в шесть вечера,
 * потеряет отметки о завтраке и обеде, и врач увидит день, в котором ребёнок
 * будто ничего не ел.
 *
 * `portion_factor` в ключ НЕ входит — у переиспользованной позиции он просто
 * обновляется. Потерять его не менее опасно, но по-другому: отметки уцелеют, а
 * ребёнок получит не ту порцию, и день сойдётся по числам, которых никто не
 * планировал.
 *
 * Поэтому преобразование живёт отдельной чистой функцией и покрыто тестами: в
 * компоненте оно оказалось бы проверяемым только через отрисовку.
 */
export function itemsOf(menu: Menu | null): DayItem[] {
  return (menu?.items ?? []).map(toDayItem);
}

export function toDayItem(item: MenuItem): DayItem {
  return {
    meal_index: item.meal_index,
    recipe_id: item.recipe_id,
    custom_dish_id: item.custom_dish_id,
    portion_factor: item.portion_factor,
  };
}

/** Добавляет блюдо к дню, не трогая уже стоящие позиции. */
export function withDish(
  items: DayItem[],
  dish: { kind: "recipe" | "custom"; id: string },
  mealIndex: number,
  portionFactor: number,
): DayItem[] {
  return [
    ...items,
    {
      meal_index: mealIndex,
      recipe_id: dish.kind === "recipe" ? dish.id : null,
      custom_dish_id: dish.kind === "custom" ? dish.id : null,
      portion_factor: portionFactor,
    },
  ];
}

/**
 * Убирает одну позицию дня.
 *
 * По идентификатору позиции, а не по блюду: одно и то же блюдо законно стоит
 * дважды в одном приёме (две порции разной величины), и удаление «по блюду»
 * сняло бы обе.
 */
export function withoutItem(menu: Menu | null, itemId: string): DayItem[] {
  return (menu?.items ?? [])
    .filter((item) => item.id !== itemId)
    .map(toDayItem);
}

/** Приёмы, между которыми раскладывают день: столько, сколько назначил врач. */
export function mealNumbers(mealsPerDay: number | null): number[] {
  // Без назначения приёмов не существует: врач их и задаёт (ADR-0029). Один
  // приём как запасной вариант был бы выдуманным медицинским решением.
  if (mealsPerDay === null || mealsPerDay < 1) return [];
  return Array.from({ length: mealsPerDay }, (_, index) => index + 1);
}
