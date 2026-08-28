import { useTranslation } from "react-i18next";

import type { DishRow } from "./types";

interface Props {
  rows: DishRow[];
  onChangeGrams: (productId: string, grams: number) => void;
  onRemove: (productId: string) => void;
  /** Массы задаёт решатель — поля только для чтения */
  readOnlyGrams?: boolean;
}

/** Состав блюда: продукт, масса, удаление. */
export function DishRows({
  rows,
  onChangeGrams,
  onRemove,
  readOnlyGrams,
}: Props) {
  const { t } = useTranslation("calculator");

  if (rows.length === 0) {
    return <p className="text-muted">{t("emptyComposition")}</p>;
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((row) => (
        <li key={row.product.id} className="flex items-center gap-3">
          <span className="flex-1">{row.product.name}</span>

          <label className="sr-only" htmlFor={`grams-${row.product.id}`}>
            {t("gramsFor", { name: row.product.name })}
          </label>
          <input
            id={`grams-${row.product.id}`}
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            readOnly={readOnlyGrams}
            value={Number.isFinite(row.grams) ? row.grams : ""}
            onChange={(event) =>
              onChangeGrams(row.product.id, Number(event.target.value))
            }
            className="min-h-touch w-24 rounded-lg border border-line bg-surface px-3 py-2 text-right tabular-nums read-only:bg-canvas read-only:text-muted"
          />
          <span className="text-muted">{t("gramsUnit")}</span>

          <button
            type="button"
            onClick={() => onRemove(row.product.id)}
            aria-label={t("removeProduct", { name: row.product.name })}
            className="min-h-touch min-w-touch rounded-lg border border-line px-3 text-ink"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
