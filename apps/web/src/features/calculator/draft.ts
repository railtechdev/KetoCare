import type { Incoming } from "./incomingItem";
import type { DishRow } from "./types";

/**
 * Черновик состава калькулятора в хранилище вкладки.
 *
 * Состав жил только в памяти экрана: обновление страницы, уход в справочник за
 * недостающим продуктом или случайный переход стирали набранное целиком
 * (`docs/AUDIT_PRODUCT_2026-11.md`, раздел 2). Хранилище вкладки, а не
 * постоянное: черновик нужен, чтобы вернуться к начатому, а не чтобы через
 * неделю открыть калькулятор с чужим, давно забытым составом.
 *
 * Ключ — ребёнок и блюдо: черновик нового блюда одного ребёнка не должен
 * всплыть ни у другого ребёнка, ни при открытии сохранённого блюда.
 *
 * Хранилища может не быть вовсе (приватное окно, запрет сайта), и тогда
 * калькулятор работает как раньше: каждое обращение — в `try`.
 */
const PREFIX = "ketocare.calculator.draft";

export function draftKey(
  patientId: string | undefined,
  incoming: Incoming | null,
): string {
  // Продукт из справочника черновик не открывает, а дополняет: он
  // добавляется к тому, что уже набрано.
  const dish =
    incoming === null || incoming.kind === "product"
      ? "new"
      : `${incoming.kind}:${incoming.id}`;
  return `${PREFIX}:${patientId ?? "none"}:${dish}`;
}

function store(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function readDraft(key: string): DishRow[] | null {
  try {
    const raw = store()?.getItem(key);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const rows = parsed.filter(isRow);
    // Испорченная запись не восстанавливается частично: половина состава
    // выглядела бы как целое блюдо.
    return rows.length > 0 && rows.length === parsed.length ? rows : null;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, rows: readonly DishRow[]): void {
  try {
    store()?.setItem(key, JSON.stringify(rows));
  } catch {
    // Переполненное или запрещённое хранилище — калькулятор работает дальше.
  }
}

export function clearDraft(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    // То же: без хранилища и стирать нечего.
  }
}

function isRow(value: unknown): value is DishRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const product = row.product as Record<string, unknown> | null | undefined;
  return (
    typeof row.grams === "number" &&
    typeof product === "object" &&
    product !== null &&
    typeof product.id === "string" &&
    typeof product.name === "string" &&
    ["kcal", "fat", "protein", "carbs", "fiber"].every(
      (field) => typeof product[field] === "number",
    )
  );
}
