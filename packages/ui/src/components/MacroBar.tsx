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
}

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
    { key: "fat", label: "Жиры", grams: fatG },
    { key: "protein", label: "Белки", grams: proteinG },
    { key: "carbs", label: "Углеводы", grams: carbsG },
  ];

  const total = segments.reduce((sum, s) => sum + Math.max(s.grams, 0), 0);

  return (
    <div className={cn("kc-macro-bar", className)}>
      <div
        className="kc-macro-bar__track"
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
                className={`kc-macro-bar__segment kc-macro-bar__segment--${segment.key}`}
                style={{ width: `${(share * 100).toFixed(2)}%` }}
                data-macro={segment.key}
              />
            );
          })}
      </div>

      <ul className="kc-macro-bar__legend">
        {segments.map((segment) => (
          <li key={segment.key} className="kc-macro-bar__legend-item">
            <span
              className={`kc-macro-bar__swatch kc-macro-bar__swatch--${segment.key}`}
              aria-hidden="true"
            />
            <span>{segment.label}</span>
            {showGrams && (
              <span className="kc-macro-bar__grams">
                {segment.grams.toFixed(1)} г
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
