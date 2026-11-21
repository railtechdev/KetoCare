import { cn } from "@ketocare/ui";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { dayStripLabel } from "./planDays";
import { horizontalShift } from "./stripScroll";
import { dayAt } from "./useMenu";

/**
 * Полоса дней вместо трёх кнопок (Р3 аудита Mini App 21.11.2026).
 *
 * Семь кнопок на 360 px не помещаются, поэтому полоса прокручивается вбок
 * внутри себя — страница при этом шире экрана не становится. Выбранный день
 * выделен и прокручивается в поле зрения. Точка под подписью — в этот день меню
 * уже составлено: диетолог собирает неделю, и семья видит, какие дни готовы,
 * не открывая каждый.
 *
 * Кнопки-переключатели (`aria-pressed`), а не вкладки: под полосой один и тот
 * же экран меню, меняется только день.
 */
export function DayStrip({
  offsets,
  value,
  onChange,
  label,
  menuDates,
}: {
  offsets: readonly number[];
  value: number;
  onChange: (offset: number) => void;
  /** Подпись группы для программы чтения с экрана. */
  label: string;
  /** Даты `YYYY-MM-DD`, в которые меню составлено; нет — точек нет. */
  menuDates?: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  const strip = useRef<HTMLDivElement>(null);
  const selected = useRef<HTMLButtonElement>(null);
  const anyMenu = offsets.some((offset) => menuDates?.has(dayAt(offset)));

  // Выбранный день — в поле зрения: открытое «на пятницу» меню не должно
  // прятать пятницу за краем полосы. Прокручивается ТОЛЬКО сама полоса и
  // только вбок: `scrollIntoView` двигает и окно, и карточка рецепта, где
  // полоса стоит последним блоком, открывалась прокрученной к «Добавить в
  // меню», мимо названия и состава.
  useEffect(() => {
    const container = strip.current;
    const button = selected.current;
    if (container === null || button === null) return;
    container.scrollLeft += horizontalShift(
      container.getBoundingClientRect(),
      button.getBoundingClientRect(),
    );
  }, [value]);

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={strip}
        role="group"
        aria-label={label}
        className="w-full max-w-full overflow-x-auto overscroll-x-contain"
      >
        <ul className="m-0 flex w-max list-none gap-1 p-0 pb-1">
          {offsets.map((offset) => {
            const date = dayAt(offset);
            const active = offset === value;
            const hasMenu = menuDates?.has(date) ?? false;
            return (
              <li key={offset}>
                <button
                  ref={active ? selected : undefined}
                  type="button"
                  aria-pressed={active}
                  data-date={date}
                  onClick={() => onChange(offset)}
                  className={cn(
                    "flex min-h-touch min-w-16 flex-col items-center justify-center gap-0.5 rounded-md border px-2 py-1 text-sm whitespace-nowrap",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    active
                      ? "border-primary bg-primary font-semibold text-primary-foreground"
                      : "border-border bg-card text-foreground",
                  )}
                >
                  <span>{dayStripLabel(offset, t)}</span>
                  {/* Точка — на месте у каждой кнопки, чтобы высоты не прыгали;
                    видна и озвучена только у дня с меню. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 rounded-full",
                      hasMenu ? "bg-current" : "bg-transparent",
                    )}
                  />
                  {hasMenu && (
                    <span className="sr-only">{t("menu.week.hasMenu")}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {/* Что значит точка, сказано словами на экране: под выбранным днём она
        одного цвета с выделением и читалась его частью. Программа чтения
        слышит «меню составлено» у самой кнопки, поэтому строка ей скрыта. */}
      {anyMenu && (
        <p
          aria-hidden="true"
          className="m-0 flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          {t("menu.week.legend")}
        </p>
      )}
    </div>
  );
}
