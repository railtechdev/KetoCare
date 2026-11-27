import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/**
 * Когда колонки расходятся — по ширине места, которое досталось самим
 * колонкам, а не окна (правило П33 для композиции экрана).
 *
 * Прежде порог был экранным (`lg:`, `xl:`). В карте пациента у колонок отнята
 * навигация карты, и на окне 1024 px основному блоку оставалось около 300 px:
 * окно было «широким», а место — нет (аудит адаптации 27.11.2026, находка А8).
 * Теперь `Columns` — контейнер, и порог — наименьшая ширина основной колонки
 * плюс приставная и промежуток:
 *
 * | `from` | основная не уже | обычная (20rem) | широкая (26rem) |
 * | ------ | --------------- | --------------- | --------------- |
 * | `md`   | 24rem           | 45rem           | 51rem           |
 * | `lg`   | 30rem           | 51rem           | 57rem           |
 * | `xl`   | 34rem           | 55rem           | 61rem           |
 *
 * На обычной странице это те же окна, что и прежде: рабочая область окна
 * 1024 px — около 55rem, 1280 px — около 70rem.
 *
 * Классы записаны целиком, а не собираются из кусков: Tailwind ищет их в
 * исходниках по тексту, и `` `${from}:grid-cols-2` `` не попадает в сборку
 * молча — раскладка просто не применяется, ошибки при этом нет нигде.
 */
const SPLIT_AT = {
  md: "@min-[45rem]:grid-cols-[minmax(0,1fr)_var(--container-aside)]",
  lg: "@min-[51rem]:grid-cols-[minmax(0,1fr)_var(--container-aside)]",
  xl: "@min-[55rem]:grid-cols-[minmax(0,1fr)_var(--container-aside)]",
} as const;

const SPLIT_WIDE_AT = {
  md: "@min-[51rem]:grid-cols-[minmax(0,1fr)_26rem]",
  lg: "@min-[57rem]:grid-cols-[minmax(0,1fr)_26rem]",
  xl: "@min-[61rem]:grid-cols-[minmax(0,1fr)_26rem]",
} as const;

const ASIDE_FIRST_AT = {
  default: {
    md: "@min-[45rem]:col-start-2 @min-[45rem]:row-start-1",
    lg: "@min-[51rem]:col-start-2 @min-[51rem]:row-start-1",
    xl: "@min-[55rem]:col-start-2 @min-[55rem]:row-start-1",
  },
  wide: {
    md: "@min-[51rem]:col-start-2 @min-[51rem]:row-start-1",
    lg: "@min-[57rem]:col-start-2 @min-[57rem]:row-start-1",
    xl: "@min-[61rem]:col-start-2 @min-[61rem]:row-start-1",
  },
} as const;

const MAIN_SECOND_AT = {
  default: {
    md: "@min-[45rem]:col-start-1 @min-[45rem]:row-start-1",
    lg: "@min-[51rem]:col-start-1 @min-[51rem]:row-start-1",
    xl: "@min-[55rem]:col-start-1 @min-[55rem]:row-start-1",
  },
  wide: {
    md: "@min-[51rem]:col-start-1 @min-[51rem]:row-start-1",
    lg: "@min-[57rem]:col-start-1 @min-[57rem]:row-start-1",
    xl: "@min-[61rem]:col-start-1 @min-[61rem]:row-start-1",
  },
} as const;

const STICKY_AT = {
  default: {
    md: "@min-[45rem]:sticky @min-[45rem]:top-20 @min-[45rem]:self-start",
    lg: "@min-[51rem]:sticky @min-[51rem]:top-20 @min-[51rem]:self-start",
    xl: "@min-[55rem]:sticky @min-[55rem]:top-20 @min-[55rem]:self-start",
  },
  wide: {
    md: "@min-[51rem]:sticky @min-[51rem]:top-20 @min-[51rem]:self-start",
    lg: "@min-[57rem]:sticky @min-[57rem]:top-20 @min-[57rem]:self-start",
    xl: "@min-[61rem]:sticky @min-[61rem]:top-20 @min-[61rem]:self-start",
  },
} as const;

export interface ColumnsProps {
  /** Основная колонка: то, ради чего пришли на экран */
  main: ReactNode;
  /**
   * Приставная колонка: справка, к которой обращаются, работая с основной.
   * `null` — справки сейчас нет, и колонка не занимает места.
   */
  aside: ReactNode;
  /** Наименьшая ширина основной колонки, при которой колонки расходятся (таблица выше) */
  from?: keyof typeof SPLIT_AT;
  /** Ширина приставной колонки: обычная (20rem) или широкая (26rem, для расчёта) */
  asideWidth?: "default" | "wide";
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
 * Ниже точки расхождения это обычный столбец блоков — те же `gap-section`, что и
 * у `PageLayout`, так что вложение не меняет вертикальный ритм.
 */
export function Columns({
  main,
  aside,
  from = "lg",
  asideWidth = "default",
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
      <div className={cn("flex flex-col gap-section", className)}>{main}</div>
    );
  }

  const mainColumn = (
    <div
      key="main"
      className={cn(
        "flex min-w-0 flex-col gap-section",
        asideFirst && MAIN_SECOND_AT[asideWidth][from],
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
        "flex min-w-0 flex-col gap-section",
        asideFirst && ASIDE_FIRST_AT[asideWidth][from],
        asideSticky && STICKY_AT[asideWidth][from],
      )}
    >
      {aside}
    </aside>
  );

  const splitClass =
    asideWidth === "wide" ? SPLIT_WIDE_AT[from] : SPLIT_AT[from];

  // Внешний блок — контейнер, внутренний — сетка: элемент не может спрашивать
  // ширину у самого себя.
  return (
    <div className={cn("@container", className)}>
      <div className={cn("grid items-start gap-section", splitClass)}>
        {asideFirst ? [asideColumn, mainColumn] : [mainColumn, asideColumn]}
      </div>
    </div>
  );
}
