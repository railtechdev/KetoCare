import { cn } from "../lib/cn";
import { formatRatio } from "../lib/format";

export interface RatioBadgeProps {
  /** Фактическое кетосоотношение блюда, напр. 3.87 */
  ratio: number | null;
  /**
   * Соответствует ли соотношение назначению.
   *
   * Приходит от сервера (`ratio_within_tolerance` в ответах `/calc/*`), а НЕ
   * вычисляется здесь. Допуск (`RATIO_TOLERANCE`) — медицинская константа из
   * `keto_engine/constants.py`; её копия в TypeScript со временем разошлась бы с
   * ядром, и интерфейс показывал бы «в норме» там, где расчётное ядро считает
   * иначе. `undefined` — назначение неизвестно, показываем нейтрально.
   */
  withinTolerance?: boolean;
  className?: string;
}

const BASE =
  "inline-flex items-center rounded-md border border-transparent px-2.5 py-0.5 " +
  "font-semibold tabular-nums whitespace-nowrap";

const BY_STATE = {
  ok: "bg-success text-on-success",
  off: "bg-destructive text-destructive-foreground",
  neutral: "bg-card text-muted-foreground border-border",
} as const;

export function RatioBadge({
  ratio,
  withinTolerance,
  className,
}: RatioBadgeProps) {
  if (ratio === null) {
    return (
      <span
        className={cn(BASE, BY_STATE.neutral, className)}
        data-state="unknown"
        aria-label="Соотношение не определено"
      >
        — : 1
      </span>
    );
  }

  const state =
    withinTolerance === undefined ? "neutral" : withinTolerance ? "ok" : "off";

  const label =
    withinTolerance === undefined
      ? `Соотношение ${formatRatio(ratio)}`
      : withinTolerance
        ? `Соотношение ${formatRatio(ratio)}, соответствует назначению`
        : `Соотношение ${formatRatio(ratio)}, отклоняется от назначения`;

  return (
    <span
      className={cn(BASE, BY_STATE[state], className)}
      data-state={state}
      aria-label={label}
    >
      {formatRatio(ratio)}
    </span>
  );
}
