import { cn } from "../lib/cn";

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

/** Формат раздела 8.2 ТЗ: «3.9 : 1». */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(1)} : 1`;
}

export function RatioBadge({
  ratio,
  withinTolerance,
  className,
}: RatioBadgeProps) {
  if (ratio === null) {
    return (
      <span
        className={cn("kc-ratio-badge kc-ratio-badge--unknown", className)}
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
      className={cn("kc-ratio-badge", `kc-ratio-badge--${state}`, className)}
      data-state={state}
      aria-label={label}
    >
      {formatRatio(ratio)}
    </span>
  );
}
