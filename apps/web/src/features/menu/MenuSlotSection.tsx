import { cn } from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AddMenuItemForm } from "./AddMenuItemForm";
import { formatPortionFactor } from "./dates";
import { itemDishKey } from "./useDishCatalog";
import type { DishKind, MealSlot, MenuItemRead } from "./useMenu";

interface Props {
  slot: MealSlot;
  items: readonly MenuItemRead[];
  /** Названия блюд по ключу источника: позиция меню несёт только ссылку */
  titles: Record<string, string>;
  patientId: string | null;
  /** Меню дня не может остаться пустым — последнюю позицию убрать нельзя */
  canRemove: boolean;
  pending: boolean;
  onAdd: (input: {
    slot: MealSlot;
    kind: DishKind;
    id: string;
    portionFactor: number;
  }) => void;
  onRemove: (itemId: string) => void;
  onToggleEaten: (itemId: string, eaten: boolean) => void;
}

/** Приём пищи: позиции плана, отметки «съедено» и добавление блюда. */
export function MenuSlotSection({
  slot,
  items,
  titles,
  patientId,
  canRemove,
  pending,
  onAdd,
  onRemove,
  onToggleEaten,
}: Props) {
  const { t } = useTranslation("menu");
  const [adding, setAdding] = useState(false);

  const slotName = t(`slots.${slot}`);

  return (
    <section
      aria-label={slotName}
      className="rounded-xl bg-card p-4 shadow-kc-sm"
    >
      <h2 className="m-0 text-lg font-semibold">{slotName}</h2>

      {items.length === 0 ? (
        <p className="mt-2 mb-0 text-muted-foreground">{t("slot.empty")}</p>
      ) : (
        <ul className="mt-3 mb-0 flex list-none flex-col gap-2 p-0">
          {items.map((item) => {
            const key = itemDishKey(item);
            const title =
              (key === null ? undefined : titles[key]) ?? t("item.unknown");

            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <label className="flex min-h-touch items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={item.eaten}
                    aria-label={t("item.eatenFor", { name: title })}
                    onChange={(event) =>
                      onToggleEaten(item.id, event.target.checked)
                    }
                  />
                  {t("item.eaten")}
                </label>

                <span
                  className={cn(
                    "flex-1",
                    item.eaten && "text-muted-foreground line-through",
                  )}
                >
                  {title}
                </span>

                <span className="text-sm text-muted-foreground">
                  {t(`item.${item.recipe_id !== null ? "recipe" : "custom"}`)}
                </span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {t("item.portion", {
                    factor: formatPortionFactor(item.portion_factor),
                  })}
                </span>

                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  disabled={!canRemove || pending}
                  aria-label={t("item.remove", { name: title })}
                  className="min-h-touch min-w-touch rounded-lg border border-border px-3 text-foreground disabled:opacity-60"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <AddMenuItemForm
          patientId={patientId}
          slot={slot}
          pending={pending}
          onAdd={(input) => {
            onAdd({ slot, ...input });
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={pending}
          aria-label={t("slot.addTo", { slot: slotName })}
          className="mt-3 min-h-touch rounded-lg border border-primary px-4 font-semibold text-primary disabled:opacity-60"
        >
          {t("slot.add")}
        </button>
      )}
    </section>
  );
}
