/**
 * Справочник типов приступов как дерево ILAE 2025 (ADR-0050, ADR-0076).
 *
 * Номер узла — `ilae_ref`: «3», «3.1», «3.1.2». Узла «3.3» в справочнике нет,
 * а «3.3.1»–«3.3.7» есть, поэтому родителем считается ближайший СУЩЕСТВУЮЩИЙ
 * предок, а не строковый: иначе миоклонический приступ потерялся бы между
 * уровнями. Тип без номера стоит на верхнем уровне — ответ, который
 * медицинская команда завела в справочник, не должен пропасть из выбора.
 *
 * Правила те же, что у бота (`apps/bot/.../scenarios.py`: `_parent_ref`,
 * `seizure_children`, `_unknown_type`), и тесты повторяют его случаи: одна и
 * та же семья выбирает тип и в чате, и в Mini App.
 */

export interface SeizureTreeNode {
  id: string;
  name: string;
  /** Номер узла классификации; пусто — тип вне дерева. */
  ilaeRef?: string | null;
}

/** «Неклассифицированный приступ» — он и есть ответ «Не знаю». */
export const UNKNOWN_SEIZURE_REF = "4";

/** Сколько типов прошлых записей ребёнка стоит первым экраном — как в боте. */
export const RECENT_SEIZURE_TYPES = 4;

export interface SeizureTreeChild<T extends SeizureTreeNode> {
  node: T;
  /** У узла есть подтипы — он открывает следующий уровень. */
  hasChildren: boolean;
}

function refOf(node: SeizureTreeNode): string {
  return node.ilaeRef ?? "";
}

function existingRefs(nodes: readonly SeizureTreeNode[]): Set<string> {
  return new Set(nodes.map(refOf).filter((ref) => ref !== ""));
}

/** Ближайший существующий предок номера; `null` — верхний уровень. */
export function seizureParentRef(
  ref: string,
  existing: ReadonlySet<string>,
): string | null {
  const parts = ref.split(".");
  for (let size = parts.length - 1; size > 0; size -= 1) {
    const candidate = parts.slice(0, size).join(".");
    if (existing.has(candidate)) return candidate;
  }
  return null;
}

/** Есть ли у справочника номера классификации: без них — плоский список. */
export function hasSeizureTree(nodes: readonly SeizureTreeNode[]): boolean {
  return existingRefs(nodes).size > 0;
}

/** Прямые подтипы узла (`null` — верхний уровень), в порядке справочника. */
export function seizureChildren<T extends SeizureTreeNode>(
  nodes: readonly T[],
  parentRef: string | null,
): SeizureTreeChild<T>[] {
  const existing = existingRefs(nodes);
  const parents = new Map<string, string | null>(
    [...existing].map((ref) => [ref, seizureParentRef(ref, existing)]),
  );
  const parentsOf = [...parents.values()];
  return nodes
    .filter((node) => {
      const ref = refOf(node);
      const parent = ref === "" ? null : (parents.get(ref) ?? null);
      return parent === parentRef;
    })
    .map((node) => {
      const ref = refOf(node);
      return {
        node,
        hasChildren: ref !== "" && parentsOf.includes(ref),
      };
    });
}

/** Узел «Не знаю», если справочник его содержит; иначе кнопки нет. */
export function unknownSeizureType<T extends SeizureTreeNode>(
  nodes: readonly T[],
): T | null {
  return nodes.find((node) => refOf(node) === UNKNOWN_SEIZURE_REF) ?? null;
}

/** Узел по номеру — чтобы назвать открытую группу и найти её родителя. */
export function seizureNodeByRef<T extends SeizureTreeNode>(
  nodes: readonly T[],
  ref: string,
): T | null {
  return nodes.find((node) => refOf(node) === ref) ?? null;
}
