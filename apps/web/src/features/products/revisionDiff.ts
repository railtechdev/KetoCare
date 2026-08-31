import type { components } from "@ketocare/api-client";

export type ProductRevision = components["schemas"]["ProductRevisionRead"];

/**
 * Поля снимка, о которых имеет смысл говорить человеку, и их порядок.
 *
 * Порядок — не алфавитный: сначала то, по чему считают ребёнку еду, потом
 * подпись источника, потом состояние позиции. Полей снимка больше (там же
 * `category_id`), но идентификатор категории без её названия ничего не
 * сообщает, а тянуть справочник ради строки истории — лишний запрос.
 */
export const REVISION_FIELDS = [
  "name_ru",
  "kcal_100g",
  "fat_100g",
  "protein_100g",
  "carbs_100g",
  "fiber_100g",
  "source",
  "source_version",
  "verified_at",
  "is_active",
] as const;

export type RevisionField = (typeof REVISION_FIELDS)[number];

export interface FieldChange {
  field: RevisionField;
  before: unknown;
  after: unknown;
}

/**
 * Что изменилось между соседними ревизиями.
 *
 * `previous === null` — это первая запись: позиция заведена, сравнивать не с
 * чем. Возвращается пустой список, и подписывает его вызывающая сторона:
 * «заведена» и «ничего не изменилось» — разные утверждения, и путать их
 * нельзя.
 */
export function changedFields(
  snapshot: Record<string, unknown>,
  previous: Record<string, unknown> | null,
): FieldChange[] {
  if (previous === null) return [];

  return REVISION_FIELDS.filter(
    (field) => !sameValue(snapshot[field], previous[field]),
  ).map((field) => ({
    field,
    before: previous[field],
    after: snapshot[field],
  }));
}

/**
 * Равенство значений снимка.
 *
 * Числа приходят из jsonb и после правки могут отличаться представлением
 * (`81.1` и `81.10`), оставаясь тем же числом: показывать такое как изменение
 * значит утверждать правку, которой не было.
 */
function sameValue(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number") {
    return Math.abs(left - right) < 1e-9;
  }
  if (typeof left === "number" || typeof right === "number") {
    return Number(left) === Number(right);
  }
  return left === right;
}
