import { formatGrams, formatKcal } from "../lib/format";
import { cn } from "../lib/cn";
import { useKitLabels } from "../lib/kitLabels";

interface MacroFactsCommon {
  /**
   * Что именно описывают числа — «Вклад продукта „Масло сливочное“ в блюдо».
   * Приходит из словаря приложения: название продукта знает экран, а не кит.
   */
  label: string;
  /** Числа посчитаны не по тому, что сейчас в полях */
  stale?: boolean;
  className?: string;
}

interface CountedFacts extends MacroFactsCommon {
  uncounted?: undefined;
  kcal: number;
  fatG: number;
  proteinG: number;
  carbsG: number;
}

interface UncountedFacts extends MacroFactsCommon {
  /**
   * Позиция в расчёт не входит — приправа (ADR-0054). Вместо чисел строка
   * говорит это словами из словаря приложения: «не учитывается в расчёте».
   *
   * Чисел у такой позиции нет вовсе, а не нули: «0 ккал» у перца — неправда,
   * у него 251 ккал на 100 г, просто их не считают. Сервер её вклада и не
   * присылает — ядро приправу не видит.
   */
  uncounted: string;
}

export type MacroFactsProps = CountedFacts | UncountedFacts;

/**
 * Показатели одной позиции состава: калории и макронутриенты на её массу.
 *
 * Та же величина, что у `MacroBar`, но в другой форме: полоса отвечает на
 * вопрос «каково соотношение», числа — «что даёт этот продукт». В строке
 * состава нужны именно числа: по ним видно, что менять, когда блюдо мимо цели
 * (так устроен и KetoDietCalculator, `docs/AUDIT_KDC.md`).
 *
 * **Живёт в ките, потому что стоит в двух каналах** — в кабинете и в Mini App.
 * Своя копия в каждом означала бы своё округление клинических чисел: у одной
 * семьи «41 г жира», у той же семьи с телефона «40.5 г».
 *
 * Числа приходят от сервера (`/calc/verify`, позиция `dish.items`) и здесь
 * только форматируются: своя арифметика в браузере — второй источник
 * клинических чисел рядом с расчётным ядром.
 *
 * Четыре ячейки одной сетки, а не фраза: фраза раскладывается по длине
 * названия, и числа соседних строк теряют общую левую линию — а сравнивают
 * именно их. Глазу — сокращения «Ж · Б · У», как в подсказке поиска продукта;
 * вспомогательной технологии — полные названия.
 */
export function MacroFacts(props: MacroFactsProps) {
  const { label, stale = false, className } = props;
  const { macros } = useKitLabels();

  // Одно место на оба канала: и кабинет, и Mini App показывают приправу этой
  // строкой, а не своей копией с другим словом или с нулями.
  if (props.uncounted !== undefined) {
    return (
      <p className={cn("m-0 text-sm text-muted-foreground", className)}>
        <span className="sr-only">{`${label}: `}</span>
        {props.uncounted}
      </p>
    );
  }

  const { kcal, fatG, proteinG, carbsG } = props;
  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={stale}
      className={cn(
        "grid grid-cols-4 gap-x-3 text-sm tabular-nums text-muted-foreground",
        stale && "opacity-60 transition-opacity",
        className,
      )}
    >
      <Cell
        full={macros.kcalFull}
        short={macros.kcalUnit}
        value={formatKcal(kcal)}
        after
      />
      <Cell
        full={macros.fatFull}
        short={macros.fatShort}
        value={formatGrams(fatG)}
      />
      <Cell
        full={macros.proteinFull}
        short={macros.proteinShort}
        value={formatGrams(proteinG)}
      />
      <Cell
        full={macros.carbsFull}
        short={macros.carbsShort}
        value={formatGrams(carbsG)}
      />
    </div>
  );
}

/**
 * Одна ячейка: подпись и число в строку.
 *
 * Единица калорий стоит ПОСЛЕ числа («367 ккал»), как в подсказке поиска и в
 * итоге блюда, а буква макронутриента — перед ним: «Ж 40.5» читается как
 * подпись со значением, «40.5 Ж» — как число с единицей измерения «Ж».
 */
function Cell({
  full,
  short,
  value,
  after = false,
}: {
  full: string;
  short: string;
  value: string;
  after?: boolean;
}) {
  const mark = (
    <span aria-hidden="true" className="shrink-0">
      {short}
    </span>
  );

  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="sr-only">{full}</span>
      {!after && mark}
      <span className="text-foreground">{value}</span>
      {after && mark}
    </span>
  );
}
