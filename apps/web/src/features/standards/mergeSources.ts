import type { FoodStandard } from "./useFoodStandards";

/**
 * Порядок источников по умолчанию — решение ADR-0067: местное руководство
 * первым, USDA для того, чего в нём нет. Узнаются по названию и издателю;
 * не нашлись — первые внешние документы по списку.
 */
export function defaultSources(references: readonly FoodStandard[]): string[] {
  const matches = (standard: FoodStandard, pattern: RegExp) =>
    pattern.test(`${standard.name} ${standard.publisher ?? ""}`);
  const first =
    references.find((standard) => matches(standard, /минздрав|mz ruz/i)) ??
    references[0];
  if (first === undefined) return [];
  const second =
    references.find(
      (standard) => standard !== first && matches(standard, /usda/i),
    ) ?? references.find((standard) => standard !== first);
  return second === undefined ? [first.id] : [first.id, second.id];
}
