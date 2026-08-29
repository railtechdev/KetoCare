import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  cn,
} from "@ketocare/ui";
import { Plus, Trash2 } from "lucide-react";
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
    <Card role="region" aria-label={slotName}>
      <CardHeader>
        <CardTitle>
          <h2 className="m-0 text-section-title">{slotName}</h2>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-block">
        {items.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">{t("slot.empty")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-field p-0">
            {items.map((item) => {
              const key = itemDishKey(item);
              const title =
                (key === null ? undefined : titles[key]) ?? t("item.unknown");

              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-field rounded-lg border border-border px-3 py-2"
                >
                  <label className="flex min-h-touch items-center gap-field text-sm">
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
                      "min-w-0 flex-1 break-words",
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

                  <ConfirmDialog
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="min-h-touch min-w-touch text-muted-foreground"
                        disabled={!canRemove || pending}
                        aria-label={t("item.remove", { name: title })}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    }
                    title={t("item.removeTitle", { name: title })}
                    description={t("item.removeDescription", {
                      slot: slotName,
                    })}
                    confirmLabel={t("item.removeConfirm")}
                    cancelLabel={t("common:actions.cancel")}
                    onConfirm={() => onRemove(item.id)}
                  />
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
          <Button
            type="button"
            variant="outline"
            className="min-h-touch self-start"
            onClick={() => setAdding(true)}
            disabled={pending}
            aria-label={t("slot.addTo", { slot: slotName })}
          >
            <Plus aria-hidden="true" />
            {t("slot.add")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
