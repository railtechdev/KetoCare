import { Button, ConfirmDialog, cn } from "@ketocare/ui";
import { Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { formatPortionFactor } from "./dates";
import { itemDishKey } from "./useDishCatalog";
import type { MealSlot, MenuItemRead } from "./useMenu";

interface Props {
  slot: MealSlot;
  items: readonly MenuItemRead[];
  /** Названия блюд по ключу источника: позиция меню несёт только ссылку */
  titles: Record<string, string>;
  /** Меню дня не может остаться пустым — последнюю позицию убрать нельзя */
  canRemove: boolean;
  pending: boolean;
  onAdd: () => void;
  onRemove: (itemId: string) => void;
  onToggleEaten: (itemId: string, eaten: boolean) => void;
}

/**
 * Приём пищи внутри дня: позиции плана, отметки «съедено», кнопка добавления.
 *
 * Своей рамки у приёма нет намеренно. Раньше каждый был отдельной карточкой, и
 * пустой день занимал 808 px на четыре строки «Блюд пока нет» — две трети окна
 * до того, как в меню появилось хоть что-то (`docs/AUDIT_UI_LAYOUT.md`).
 * Приёмы — части одного дня, а не четыре независимых блока, поэтому они лежат
 * в одном блоке «Приёмы пищи» заголовками третьего уровня (правило П24).
 */
export function MealSlotGroup({
  slot,
  items,
  titles,
  canRemove,
  pending,
  onAdd,
  onRemove,
  onToggleEaten,
}: Props) {
  const { t } = useTranslation("menu");
  const headingId = useId();

  const slotName = t(`slots.${slot}`);

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-field py-block first:pt-0 last:pb-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-field">
        <h3 id={headingId} className="m-0 text-card-title font-semibold">
          {slotName}
        </h3>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-touch"
          onClick={onAdd}
          disabled={pending}
          aria-label={t("slot.addTo", { slot: slotName })}
        >
          <Plus aria-hidden="true" />
          {t("slot.add")}
        </Button>
      </div>

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
                className="flex flex-wrap items-center gap-field rounded-lg border border-border px-3 py-1"
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
                  description={t("item.removeDescription", { slot: slotName })}
                  confirmLabel={t("item.removeConfirm")}
                  cancelLabel={t("common:actions.cancel")}
                  onConfirm={() => onRemove(item.id)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
