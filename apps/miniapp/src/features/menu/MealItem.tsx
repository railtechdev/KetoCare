import { Checkbox, WarningBanner } from "@ketocare/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { MenuItem } from "./useMenu";

/** Причина отказа отметки — описание её флажка для скринридера. */
function markFailedId(itemId: string): string {
  return `mark-failed-${itemId}`;
}

/**
 * Строка блюда в меню с отметкой «съедено» — одна на «Сегодня» и на меню дня.
 *
 * Две копии разошлись бы в главном: какой флажок можно ставить и что сказано,
 * когда отметка не прошла.
 */
export function MealItem({
  item,
  canMarkEaten,
  pending,
  failed,
  failure,
  onToggle,
  actions,
  children,
}: {
  item: MenuItem;
  /**
   * Ставится ли отметка. На завтра — нет: съесть будущий день нельзя, а флажок
   * у завтрашнего меню читался бы как «отметьте заранее». Уже отмеченную
   * позицию снять можно всегда — иначе ошибочную отметку было бы не убрать.
   */
  canMarkEaten: boolean;
  pending: boolean;
  failed: boolean;
  failure: string;
  onToggle: (item: MenuItem) => void;
  /** Действия справа: «Убрать». */
  actions?: ReactNode;
  /** Под строкой: «Что взвесить», «Как готовить». */
  children?: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start justify-between gap-field">
        {canMarkEaten || item.eaten ? (
          // Вся строка — цель касания не ниже 44 px, а не квадрат флажка:
          // отмечают на ходу, одной рукой.
          <label className="flex min-h-touch min-w-0 flex-1 cursor-pointer items-center gap-field py-1">
            <Checkbox
              checked={item.eaten}
              disabled={pending}
              aria-describedby={failed ? markFailedId(item.id) : undefined}
              onChange={() => {
                onToggle(item);
              }}
            />
            <DishTitle item={item} />
          </label>
        ) : (
          <p className="m-0 flex min-h-touch min-w-0 flex-1 items-center py-1">
            <DishTitle item={item} />
          </p>
        )}
        {actions}
      </div>

      {/* Отказ отметки — словами и под той позицией, которую не приняли:
          галочка, молча вернувшаяся назад, читалась бы как «нажатие не
          сработало» (ADR-0034). */}
      {failed && (
        <WarningBanner
          id={markFailedId(item.id)}
          level="danger"
          title={t("menu.markFailed")}
          className="ml-8 w-auto"
        >
          {failure}
        </WarningBanner>
      )}
      {children}
    </div>
  );
}

/** Название позиции и пометка о правке рецепта после сохранения дня. */
function DishTitle({ item }: { item: MenuItem }) {
  const { t } = useTranslation();
  return (
    <span className="min-w-0 break-words">
      {item.title ?? t("menu.unknownDish")}
      {item.changed_since_saved && (
        // День от правки рецепта не меняется — в том и смысл снимка, — но
        // семье решать, пересобрать его или нет.
        <span className="block text-sm text-muted-foreground">
          {t("menu.changedSinceSaved")}
        </span>
      )}
    </span>
  );
}
