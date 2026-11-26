import {
  Checkbox,
  WarningBanner,
  formatKcal,
  formatNumber,
  formatRatio,
} from "@ketocare/ui";
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
            {/* Галочка подписана: тексты говорят «поставьте „Съедено“», а
                безымянный квадрат читался как «выбрано» или «приготовлено»
                (аудит 26.11.2026, 3.6). */}
            <span className="flex shrink-0 flex-col items-center gap-0.5">
              <Checkbox
                checked={item.eaten}
                disabled={pending}
                aria-describedby={failed ? markFailedId(item.id) : undefined}
                onChange={() => {
                  onToggle(item);
                }}
              />
              <span
                aria-hidden="true"
                className="text-xs text-muted-foreground"
              >
                {t("menu.eatenLabel")}
              </span>
            </span>
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

/**
 * Название позиции. Пометка о правке состава после сохранения дня — с
 * действием, в `StaleItemNote` под строкой, а не серой строкой здесь.
 */
function DishTitle({ item }: { item: MenuItem }) {
  const { t } = useTranslation();
  const computed = item.computed ?? null;
  return (
    <span className="min-w-0 break-words">
      {item.title ?? t("menu.unknownDish")}
      {/* Порция не 1 — видна в строке: «0,5» вводили при сборке дня, а потом
          нигде не видели, и два одинаковых блюда с разной порцией выглядели
          одинаково (аудит 26.11.2026, 3.15). */}
      {item.portion_factor !== 1 && (
        <span className="text-muted-foreground tabular-nums">
          {" "}
          {t("menu.portion", {
            value: formatNumber(
              item.portion_factor,
              Number.isInteger(item.portion_factor)
                ? 0
                : Number.isInteger(item.portion_factor * 10)
                  ? 1
                  : 2,
            ),
          })}
        </span>
      )}
      {/* Калорийность порции — сверить с листом диетолога (аудит 26.11.2026,
          1.13). Считает сервер тем же расчётом, что итоги дня. */}
      {computed !== null && (
        <span className="block text-sm text-muted-foreground tabular-nums">
          {computed.ratio === null
            ? t("menu.itemKcal", { kcal: formatKcal(computed.kcal) })
            : t("menu.itemKcalRatio", {
                kcal: formatKcal(computed.kcal),
                ratio: formatRatio(computed.ratio),
              })}
        </span>
      )}
    </span>
  );
}
