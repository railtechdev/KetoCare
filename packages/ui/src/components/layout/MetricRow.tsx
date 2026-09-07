import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/**
 * Ряд показателей: столько столбцов, сколько влезает.
 *
 * `auto-fit` вместо брейкпоинтов — потому что ряд показателей встречается и во
 * всю ширину экрана, и в приставной колонке 20rem, и внутри панели. Раскладка,
 * записанная через `sm:grid-cols-2`, спрашивает о ширине ОКНА и в узкой колонке
 * на широком мониторе остаётся двухстолбцовой: подписи ломаются, числа налезают
 * друг на друга. `auto-fit` спрашивает о ширине самого ряда, поэтому один и тот
 * же блок верен в обоих местах и не требует от экрана знать, где он стоит.
 *
 * Разметка — список определений: показатель это пара «что» и «сколько», и
 * скринридер читает её парами, а не восемью подряд идущими абзацами.
 */
export interface MetricRowProps {
  /**
   * Наименьшая ширина столбца. `narrow` — числа с короткой подписью,
   * `wide` — подписи в два-три слова.
   */
  min?: "narrow" | "wide";
  /** Подпись ряда для скринридера, если видимого заголовка над ним нет */
  label?: string;
  className?: string;
  children: ReactNode;
}

/**
 * `min(…,100%)` внутри `minmax` обязателен: без него столбец шириной 14rem
 * шире, чем контейнер на телефоне, и ряд вылезает за экран горизонтальной
 * прокруткой — молча, без ошибки где бы то ни было.
 */
const MIN_WIDTH = {
  narrow: "grid-cols-[repeat(auto-fit,minmax(min(9rem,100%),1fr))]",
  wide: "grid-cols-[repeat(auto-fit,minmax(min(14rem,100%),1fr))]",
} as const;

export function MetricRow({
  min = "narrow",
  label,
  className,
  children,
}: MetricRowProps) {
  return (
    <dl
      aria-label={label}
      className={cn("m-0 grid gap-block", MIN_WIDTH[min], className)}
    >
      {children}
    </dl>
  );
}

export interface MetricProps {
  label: ReactNode;
  /** Значение; `null` — измерения не было. Прочерк ставит компонент. */
  value: ReactNode;
  /** Единица или пояснение рядом со значением */
  unit?: ReactNode;
  /** Подпись под значением: когда измерено, чем измерено */
  hint?: ReactNode;
  /** Крупное число — для показателя, ради которого пришли на экран */
  emphasis?: boolean;
}

/**
 * Один показатель: подпись, значение, необязательные единица и пояснение.
 *
 * `tabular-nums` не по желанию, а всегда: столбец чисел с пропорциональными
 * цифрами прыгает по горизонтали, и сравнивать соседние строки глазом
 * становится нельзя.
 */
export function Metric({ label, value, unit, hint, emphasis }: MetricProps) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="m-0 flex flex-wrap items-baseline gap-1">
        <span
          className={cn(
            "tabular-nums",
            emphasis ? "text-metric font-semibold" : "font-medium",
          )}
        >
          {value ?? "—"}
        </span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </dd>
      {hint && (
        <dd className="m-0 mt-1 text-sm text-muted-foreground">{hint}</dd>
      )}
    </div>
  );
}
