import type { MenuRead } from "./useMenu";

/**
 * Позиции дня, в составе которых есть выведенный из оборота продукт:
 * id позиции → названия продуктов.
 *
 * Сервер отдаёт обратную раскладку (продукт → позиции), потому что баннер над
 * днём перечисляет именно продукты. Строке меню нужно другое: что не так
 * ИМЕННО с этим блюдом.
 */
export function withdrawnByItem(
  withdrawn: MenuRead["withdrawn_products"] | undefined,
): Record<string, string[]> {
  const byItem: Record<string, string[]> = {};
  for (const entry of withdrawn ?? []) {
    for (const itemId of entry.item_ids) {
      (byItem[itemId] ??= []).push(entry.name_ru);
    }
  }
  return byItem;
}
