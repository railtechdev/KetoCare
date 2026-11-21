/**
 * Что взвесить за несколько дней меню — граммы позиций, сложенные по продукту.
 *
 * Живёт в ките с 21.11.2026 (Р3 аудита Mini App): список видят и кабинет
 * (лист «Что взвесить за неделю», ADR-0092), и Mini App («Что купить»). Две
 * копии сложения однажды разошлись бы, и семья купила бы по телефону не то, что
 * напечатано на листе.
 *
 * Сервер уже отдаёт граммы на позицию (с учётом порций), поэтому здесь только
 * сумма — ни пересчёта, ни запаса: запас на отходы при чистке — решение семьи.
 * Приправы (ADR-0054) идут отдельным списком без граммов.
 *
 * Кит не зависит от `@ketocare/api-client`, поэтому форма дня повторена
 * структурно — ровно те поля, которые читает сложение (`MenuWeekRead` сервера).
 */
export interface ShoppingIngredient {
  product_id: string;
  name_ru: string;
  /** Граммы на позицию меню — уже с порциями. */
  grams: number;
  /** `false` — приправа: в расчёт не входит и взвешивать её не нужно. */
  counts_in_calculation?: boolean;
}

export interface ShoppingDay {
  date: string;
  menu?: {
    items?: readonly { ingredients?: readonly ShoppingIngredient[] | null }[];
  } | null;
}

export interface ShoppingLine {
  productId: string;
  name: string;
  /** Сумма граммов по всем позициям дней — сколько взвесить, не купить. */
  grams: number;
  /** В скольких днях продукт встречается. */
  days: number;
}

export interface ShoppingList {
  lines: ShoppingLine[];
  seasonings: string[];
}

export function shoppingList(input: {
  days?: readonly ShoppingDay[] | null;
}): ShoppingList {
  const byProduct = new Map<
    string,
    { line: ShoppingLine; dates: Set<string> }
  >();
  const seasonings = new Map<string, string>();
  for (const day of input.days ?? []) {
    for (const item of day.menu?.items ?? []) {
      for (const row of item.ingredients ?? []) {
        if (row.counts_in_calculation === false) {
          seasonings.set(row.product_id, row.name_ru);
          continue;
        }
        const entry = byProduct.get(row.product_id) ?? {
          line: {
            productId: row.product_id,
            name: row.name_ru,
            grams: 0,
            days: 0,
          },
          dates: new Set<string>(),
        };
        entry.line.grams += row.grams;
        entry.dates.add(day.date);
        byProduct.set(row.product_id, entry);
      }
    }
  }
  const lines = [...byProduct.values()]
    .map(({ line, dates }) => ({ ...line, days: dates.size }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return {
    lines,
    seasonings: [...seasonings.values()].sort((a, b) =>
      a.localeCompare(b, "ru"),
    ),
  };
}

/** Дни, в которых меню составлено, — их и называет список («дней с меню: N»). */
export function daysWithMenu<Day extends ShoppingDay>(
  days: readonly Day[] | null | undefined,
): Day[] {
  return (days ?? []).filter((day) => (day.menu?.items ?? []).length > 0);
}
