import { cn } from "../lib/cn";

export interface MacroBarProps {
  fatG: number;
  proteinG: number;
  carbsG: number;
  /** Показывать граммы рядом с подписями */
  showGrams?: boolean;
  className?: string;
}

interface Segment {
  key: "fat" | "protein" | "carbs";
  label: string;
  grams: number;
  color: string;
}

const SEGMENT_COLORS = {
  fat: "bg-accent",
  protein: "bg-warning",
  carbs: "bg-danger",
} as const;

/**
 * Полоса распределения Ж/Б/У (раздел 8.2 ТЗ).
 *
 * Доли считаются по массе, а не по калорийности: на кетодиете жиры при пересчёте
 * в килокалории вытесняют остальное почти полностью (9 ккал/г против 4), и полоса
 * перестала бы показывать белки с углеводами, ради которых её и смотрят.
 */
export function MacroBar({
  fatG,
  proteinG,
  carbsG,
  showGrams = true,
  className,
}: MacroBarProps) {
  const segments: Segment[] = [
    { key: "fat", label: "Жиры", grams: fatG, color: SEGMENT_COLORS.fat },
    {
      key: "protein",
      label: "Белки",
      grams: proteinG,
      color: SEGMENT_COLORS.protein,
    },
    {
      key: "carbs",
      label: "Углеводы",
      grams: carbsG,
      color: SEGMENT_COLORS.carbs,
    },
  ];

  const total = segments.reduce((sum, s) => sum + Math.max(s.grams, 0), 0);

  return (
    <div className={cn("w-full", className)}>
      <div
        className="flex h-3 overflow-hidden rounded-full bg-line"
        role="img"
        aria-label={segments
          .map((s) => `${s.label} ${s.grams.toFixed(1)} г`)
          .join(", ")}
      >
        {total > 0 &&
          segments.map((segment) => {
            const share = Math.max(segment.grams, 0) / total;
            if (share === 0) return null;
            return (
              <span
                key={segment.key}
                className={segment.color}
                style={{ width: `${(share * 100).toFixed(2)}%` }}
                data-macro={segment.key}
              />
            );
          })}
      </div>

      <ul className="mt-2 flex list-none flex-wrap gap-4 p-0 text-sm text-ink">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span
              className={cn("size-2.5 rounded-sm", segment.color)}
              aria-hidden="true"
            />
            <span>{segment.label}</span>
            {showGrams && (
              <span className="text-muted tabular-nums">
                {segment.grams.toFixed(1)} г
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
