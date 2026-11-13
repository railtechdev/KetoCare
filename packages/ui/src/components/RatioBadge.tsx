import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { cn } from "../lib/cn";
import { formatRatio } from "../lib/format";
import { useKitLabels } from "../lib/kitLabels";

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
  /**
   * Целевое значение кетосоотношения из назначения (напр. 4.0) — только для
   * подписи. Вердикта цель не даёт: без `withinTolerance` значок нейтральный.
   * До 13.11.2026 значок при одной цели решал сам («|ratio − цель| ≤ 0.15»), и
   * зелёная галочка стояла там, где сервер вердикта не давал: у устаревшего
   * состава калькулятора, у дня, посчитанного прежней версией ядра, и в списке
   * пациентов (аудит расчётов 13.11.2026).
   */
  targetRatio?: number;
  /**
   * Печатать цель внутри значка: «4.2 : 1 (Цель: 3.5 : 1)». В узкой колонке
   * таблицы цель ставят строкой под значком, и вдвое широкий значок выталкивал
   * соседние колонки за край. Для скринридера цель остаётся в подписи всегда.
   */
  showTarget?: boolean;
  className?: string;
}

// `w-fit`: значок — по своему тексту в любом родителе. В вертикальной
// колонке (`flex-col`) элементы растягиваются на всю ширину, и в списке
// пациентов «4.0 : 1» стояло в пустой рамке шириной с колонку — как поле ввода.
const BASE =
  "inline-flex w-fit items-center rounded-md border border-transparent px-2.5 py-0.5 " +
  "font-semibold tabular-nums whitespace-nowrap";

const BY_STATE = {
  ok: "bg-success text-on-success",
  off: "bg-destructive text-destructive-foreground",
  neutral: "bg-card text-muted-foreground border-border",
} as const;

export function RatioBadge({
  ratio,
  withinTolerance,
  targetRatio,
  showTarget = true,
  className,
}: RatioBadgeProps) {
  const labels = useKitLabels().ratio;

  if (ratio === null) {
    return (
      <span
        className={cn(BASE, BY_STATE.neutral, className)}
        data-state="unknown"
        aria-label={labels.unknown}
      >
        —
        {targetRatio !== undefined && (
          <span className="ml-1.5 font-normal text-muted-foreground">
            ({labels.target(formatRatio(targetRatio))})
          </span>
        )}
      </span>
    );
  }

  // Расширенный режим: рядом с числом — цель из назначения. Вердикт — только
  // от сервера; без него значок нейтральный, а цель остаётся подписью.
  if (targetRatio !== undefined) {
    const state =
      withinTolerance === undefined
        ? "neutral"
        : withinTolerance
          ? "ok"
          : "off";
    const StatusIcon =
      state === "ok" ? CheckCircle2 : state === "off" ? AlertTriangle : null;

    const statusClasses =
      state === "ok"
        ? "bg-success-subtle text-success border-success/30"
        : state === "off"
          ? "bg-warning-subtle text-warning-strong border-warning/30"
          : "bg-card text-muted-foreground border-border";

    const verdictLabel =
      state === "ok"
        ? labels.within(formatRatio(ratio))
        : state === "off"
          ? labels.off(formatRatio(ratio))
          : labels.plain(formatRatio(ratio));
    const label = `${verdictLabel}. ${labels.target(formatRatio(targetRatio))}`;

    return (
      <span
        className={cn(BASE, statusClasses, className)}
        data-state={state}
        aria-label={label}
      >
        {StatusIcon && (
          <StatusIcon className="mr-1.5 size-3.5 shrink-0" aria-hidden="true" />
        )}
        <span>{formatRatio(ratio)}</span>
        {showTarget && (
          <span className="ml-1.5 font-normal opacity-85">
            ({labels.target(formatRatio(targetRatio))})
          </span>
        )}
      </span>
    );
  }

  // Базовый режим обратной совместимости: только ratio и withinTolerance
  const state =
    withinTolerance === undefined ? "neutral" : withinTolerance ? "ok" : "off";

  const label =
    withinTolerance === undefined
      ? labels.plain(formatRatio(ratio))
      : withinTolerance
        ? labels.within(formatRatio(ratio))
        : labels.off(formatRatio(ratio));

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
