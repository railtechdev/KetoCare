import { formatMass } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import type { MenuWeek } from "./useWeek";

export interface ShoppingLine {
  productId: string;
  name: string;
  /** Сумма граммов по всем позициям недели — сколько взвесить, не купить. */
  grams: number;
  days: number;
}

/**
 * Что взвесить за неделю: граммы позиций, сложенные по продукту.
 *
 * Сервер уже отдаёт граммы на позицию (с учётом порций), поэтому здесь только
 * сумма — ни пересчёта, ни запаса: запас на отходы при чистке — решение семьи,
 * и лист так и говорит. Приправы (ADR-0054) идут отдельным списком без граммов.
 */
export function shoppingList(week: MenuWeek): {
  lines: ShoppingLine[];
  seasonings: string[];
} {
  const byProduct = new Map<
    string,
    { line: ShoppingLine; dates: Set<string> }
  >();
  const seasonings = new Map<string, string>();
  for (const day of week.days ?? []) {
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

/**
 * Сколько строк списка помещается на лист с запасом на перенос длинного
 * названия. Длинный список делится на листы: у каждого своя шапка с именем
 * ребёнка и свой номер страницы — лист, перетёкший на вторую страницу сам,
 * остался бы там без шапки, а «Стр. X из Y» считало бы его одной страницей.
 */
export const SHOPPING_ROWS_PER_SHEET = 20;

/** Список, нарезанный на листы; приправы и примечание — на последнем. */
export function shoppingPages(
  lines: readonly ShoppingLine[],
): ShoppingLine[][] {
  const pages: ShoppingLine[][] = [];
  for (let at = 0; at < lines.length; at += SHOPPING_ROWS_PER_SHEET) {
    pages.push(lines.slice(at, at + SHOPPING_ROWS_PER_SHEET));
  }
  return pages;
}

/** Лист «Что взвесить за неделю» (ADR-0092, этап 6) — один из листов списка. */
export function ShoppingListSheet({
  lines,
  seasonings,
  rangeLabel,
  days,
  first,
  last,
}: {
  lines: readonly ShoppingLine[];
  seasonings: readonly string[];
  rangeLabel: string;
  /** Сколько дней недели с меню сложено в список. */
  days: number;
  /** Первый лист несёт заголовок и пояснение, последний — приправы и примечание. */
  first: boolean;
  last: boolean;
}) {
  const { t } = useTranslation("menu");

  return (
    <div className="flex flex-col gap-[5mm] text-[12pt] leading-snug">
      <div className="flex flex-col gap-[1.5mm]">
        <h1 className="m-0 text-[20pt] leading-tight font-bold">
          {first
            ? t("shopping.title")
            : t("shopping.continued", { title: t("shopping.title") })}
        </h1>
        <p className="m-0 text-[#3d4556]">
          {t("shopping.intro", { range: rangeLabel, days })}
        </p>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-[#1a1f2e] text-left">
            <th
              scope="col"
              className="w-[8mm] py-[1.5mm]"
              aria-label={t("shopping.bought")}
            />
            <th scope="col" className="py-[1.5mm] pr-[3mm] font-semibold">
              {t("shopping.product")}
            </th>
            <th
              scope="col"
              className="py-[1.5mm] pr-[3mm] text-right font-semibold"
            >
              {t("shopping.weight")}
            </th>
            <th scope="col" className="py-[1.5mm] text-right font-semibold">
              {t("shopping.days")}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={line.productId}
              className="break-inside-avoid border-b border-[#c9ced8]"
            >
              <td className="py-[1.5mm]">
                <span
                  aria-hidden="true"
                  className="inline-block size-[4.5mm] border-[1.5px] border-[#1a1f2e]"
                />
              </td>
              <td className="py-[1.5mm] pr-[3mm]">{line.name}</td>
              <td className="py-[1.5mm] pr-[3mm] text-right font-semibold whitespace-nowrap tabular-nums">
                {t("shopping.grams", { value: formatMass(line.grams) })}
              </td>
              <td className="py-[1.5mm] text-right tabular-nums">
                {line.days}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {last && seasonings.length > 0 && (
        <p className="m-0">
          <b>{t("shopping.seasonings")}</b> {seasonings.join(", ")}
        </p>
      )}
      {last && (
        <p className="m-0 text-[10.5pt] text-[#4a5263]">{t("shopping.note")}</p>
      )}
    </div>
  );
}
