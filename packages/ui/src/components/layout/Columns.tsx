import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/**
 * С какой ширины окна колонки расходятся.
 *
 * Классы записаны целиком, а не собираются из кусков: Tailwind ищет их в
 * исходниках по тексту, и `` `${from}:grid-cols-2` `` не попадает в сборку
 * молча — раскладка просто не применяется, ошибки при этом нет нигде.
 */
const SPLIT_AT = {
  md: "md:grid-cols-[minmax(0,1fr)_var(--container-aside)]",
  lg: "lg:grid-cols-[minmax(0,1fr)_var(--container-aside)]",
  xl: "xl:grid-cols-[minmax(0,1fr)_var(--container-aside)]",
} as const;

/**
 * Приставная колонка стоит в разметке первой, а визуально всё равно справа.
 *
 * Нужно там, где приставное содержимое — итог, к которому идёт основное: на
 * телефоне колонки складываются в одну, и итоги дня уезжали под шесть приёмов
 * пищи, хотя до этого стояли над ними. Телефон у семьи — основной сценарий, и
 * разворот приоритета на нём дороже, чем выигрыш на широком экране.
 *
 * Порядок чтения при этом остаётся честным: он одинаков на обеих ширинах —
 * сначала итог, потом состав. Перестановка задаётся размещением в сетке, а не
 * `order`, поэтому и клавиатура, и скринридер идут в том же порядке, что глаз.
 */
const ASIDE_FIRST_AT = {
  md: "md:col-start-2 md:row-start-1",
  lg: "lg:col-start-2 lg:row-start-1",
  xl: "xl:col-start-2 xl:row-start-1",
} as const;

const MAIN_SECOND_AT = {
  md: "md:col-start-1 md:row-start-1",
  lg: "lg:col-start-1 lg:row-start-1",
  xl: "xl:col-start-1 xl:row-start-1",
} as const;

const STICKY_AT = {
  md: "md:sticky md:top-20 md:self-start",
  lg: "lg:sticky lg:top-20 lg:self-start",
  xl: "xl:sticky xl:top-20 xl:self-start",
} as const;

export interface ColumnsProps {
  /** Основная колонка: то, ради чего пришли на экран */
  main: ReactNode;
  /**
   * Приставная колонка: справка, к которой обращаются, работая с основной.
   * `null` — справки сейчас нет, и колонка не занимает места.
   */
  aside: ReactNode;
  /** С какой ширины колонки расходятся; уже — одна колонка */
  from?: keyof typeof SPLIT_AT;
  /**
   * Приставная колонка не уезжает при прокрутке основной. Для справки, к
   * которой обращаются постоянно: итоги дня рядом с составом меню.
   */
  asideSticky?: boolean;
  /** Подпись приставной колонки для скринридера */
  asideLabel: string;
  /**
   * Приставная колонка идёт в разметке первой — и потому первой читается,
   * когда колонки складываются в одну. Для приставного содержимого, которое
   * подводит итог основному: итоги дня над составом меню.
   */
  asideFirst?: boolean;
  className?: string;
}

/**
 * Экран из основной и приставной колонки.
 *
 * Существует потому, что до него ширину использовали шесть экранов из
 * тридцати — во всём `apps/web` было шесть объявлений `lg:grid-cols-*`, а `md:`
 * не встречалось ни разу. Остальные складывали блоки в один столбец любой
 * ширины экрана: на мониторе 1920 главная родителя занимала 1152 px и
 * оставляла 488 px пустоты, а «Активное назначение» лежало под «Итогами дня»
 * вместо того, чтобы стоять рядом.
 *
 * Порядок в разметке — основное, потом приставное: когда колонки складываются в
 * одну (телефон), пользователь получает главное первым. Поэтому приставная
 * колонка не годится для того, без чего экран не работает.
 *
 * Исключение — `asideFirst`: приставное содержимое, подводящее итог основному
 * (итоги дня над составом меню), обязано читаться раньше и на телефоне тоже.
 *
 * Ниже точки расхождения это обычный столбец блоков — те же `gap-block`, что и
 * у `PageLayout`, так что вложение не меняет вертикальный ритм.
 */
export function Columns({
  main,
  aside,
  from = "lg",
  asideSticky = false,
  asideFirst = false,
  asideLabel,
  className,
}: ColumnsProps) {
  // Пустая приставная колонка не резервирует места. Иначе экран показывал бы
  // 20rem пустоты рядом с содержимым: в меню пустого дня итогов ещё нет, и
  // справа от плана оставался пустой столбец шириной с сам план (правило П27).
  if (aside === null || aside === undefined || aside === false) {
    return (
      <div className={cn("flex flex-col gap-block", className)}>{main}</div>
    );
  }

  const mainColumn = (
    <div
      key="main"
      className={cn(
        "flex min-w-0 flex-col gap-block",
        asideFirst && MAIN_SECOND_AT[from],
      )}
    >
      {main}
    </div>
  );

  const asideColumn = (
    <aside
      key="aside"
      aria-label={asideLabel}
      className={cn(
        "flex min-w-0 flex-col gap-block",
        asideFirst && ASIDE_FIRST_AT[from],
        asideSticky && STICKY_AT[from],
      )}
    >
      {aside}
    </aside>
  );

  return (
    <div
      className={cn("grid items-start gap-block", SPLIT_AT[from], className)}
    >
      {asideFirst ? [asideColumn, mainColumn] : [mainColumn, asideColumn]}
    </div>
  );
}
