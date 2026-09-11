/**
 * Что пришло в калькулятор через `?item=`.
 *
 * Раньше это был только идентификатор продукта из справочника. Теперь тем же
 * параметром приходит готовое блюдо — рецепт или своя раскладка: у вкладки
 * «Пересчитать» не было источника вовсе, и «пересчитать готовое блюдо»
 * начиналось с набора состава руками, то есть не давало ничего сверх
 * «Проверить».
 *
 * Префикс, а не отдельный параметр: значение по-прежнему описывает один
 * предмет, который экран должен открыть, и разбирать его в одном месте дешевле,
 * чем сводить два параметра, которые могут прийти вместе.
 *
 * Модуль без хуков и запросов намеренно. Разбор адреса нужен и общему хуку
 * выбора ребёнка (`useSelectedPatient`), который грузится при старте кабинета:
 * живя рядом с `useIncomingComposition`, он тянул в основной кусок сборки
 * запросы состава блюда и `useCustomDishes`.
 */
export type Incoming =
  | { kind: "product"; id: string }
  | { kind: "recipe"; id: string }
  | { kind: "dish"; id: string };

export function parseIncoming(item: string | undefined): Incoming | null {
  if (item === undefined || item === "") return null;
  if (item.startsWith("recipe:")) {
    return { kind: "recipe", id: item.slice("recipe:".length) };
  }
  if (item.startsWith("dish:")) {
    return { kind: "dish", id: item.slice("dish:".length) };
  }
  return { kind: "product", id: item };
}

export function incomingRecipe(recipeId: string): string {
  return `recipe:${recipeId}`;
}

export function incomingDish(dishId: string): string {
  return `dish:${dishId}`;
}

/**
 * Объект из `?item=` принадлежит ребёнку и при смене ребёнка к другому не
 * переходит.
 *
 * Сегодня это только своё блюдо: рецепт и продукт общие. В разделах, где
 * `item` не в формате калькулятора (рецепты, продукты, профиль ребёнка),
 * значение без префикса — не блюдо, и правило его не трогает. Правило стоит
 * рядом с форматом: новый вид объекта ребёнка появится в разборе, и решать,
 * принадлежит ли он ребёнку, придётся здесь же, а не в хуке выбора.
 */
export function ownedByChild(item: string | undefined): boolean {
  return parseIncoming(item)?.kind === "dish";
}
