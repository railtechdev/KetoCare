import { cn } from "../lib/cn";

export interface MacroFactsProps {
  kcal: number;
  fatG: number;
  proteinG: number;
  carbsG: number;
  /**
   * Что именно описывают числа — «Вклад продукта „Масло сливочное“ в блюдо».
   * Приходит из словаря приложения: название продукта знает экран, а не кит.
   */
  label: string;
  /** Числа посчитаны не по тому, что сейчас в полях */
  stale?: boolean;
  className?: string;
}

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
export function MacroFacts({
  kcal,
  fatG,
  proteinG,
  carbsG,
  label,
  stale = false,
  className,
}: MacroFactsProps) {
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
        full="Калорийность, ккал"
        short="ккал"
        value={kcal.toFixed(0)}
        after
      />
      <Cell full="Жиры, г" short="Ж" value={fatG.toFixed(1)} />
      <Cell full="Белки, г" short="Б" value={proteinG.toFixed(1)} />
      <Cell full="Углеводы, г" short="У" value={carbsG.toFixed(1)} />
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
