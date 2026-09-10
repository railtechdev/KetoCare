import { cn } from "../lib/cn";

export interface MacroBarProps {
  fatG: number;
  proteinG: number;
  carbsG: number;
  /**
   * Углеводы за вычетом клетчатки, подпись перед числом и пояснение после.
   *
   * Показываются рядом с общими: соотношение считается по чистым (ответ клиники
   * от 09.09.2026, вопросы 2 и 6), и без этого числа проверить его нечем.
   *
   * **Число стоит внутри фразы, а не в её конце.** Собранная как «подпись плюс
   * число», строка читалась «по ним считается кетосоотношение: 4,0 г» — то
   * есть обещала, что соотношение и есть эти граммы. Поэтому подписи две:
   * `label` идёт до числа, `note` — после.
   *
   * Обе приходят из словаря приложения, а не живут здесь: это клиническая
   * формулировка, и править её будет медицинская команда — как дисклеймер
   * помощника. Так же устроен `MacroFacts`.
   *
   * Не передано — строки нет: у сохранённых расчётов чистых углеводов не
   * хранится, и восстановить их из снимка точно нельзя.
   */
  netCarbs?: { grams: number; label: string; note?: string };
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
  fat: "bg-primary",
  protein: "bg-warning",
  carbs: "bg-destructive",
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
  netCarbs,
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
        className="flex h-3 overflow-hidden rounded-full bg-border"
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

      <ul className="mt-2 flex list-none flex-wrap gap-4 p-0 text-sm text-foreground">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span
              className={cn("size-2.5 rounded-sm", segment.color)}
              aria-hidden="true"
            />
            <span>{segment.label}</span>
            {showGrams && (
              <span className="text-muted-foreground tabular-nums">
                {segment.grams.toFixed(1)} г
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* Чистые углеводы — отдельной строкой под полосой, а не четвёртым
          сегментом: они не добавляют массы, а объясняют соотношение. */}
      {netCarbs !== undefined && (
        <p className="mt-1 mb-0 text-sm text-muted-foreground">
          {netCarbs.label}{" "}
          <span className="tabular-nums">{netCarbs.grams.toFixed(1)} г</span>
          {netCarbs.note !== undefined && ` — ${netCarbs.note}`}
        </p>
      )}
    </div>
  );
}
