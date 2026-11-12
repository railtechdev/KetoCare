/**
 * Everything the cabinet keeps in this tab's `sessionStorage` starts with
 * `ketocare` — calculator drafts and the family access code just issued.
 * Signing out removes them: on a shared computer the next person must not find
 * a child's dish draft or a live access code in the same tab.
 */
export function clearTabStorage(): void {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith("ketocare")) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage may be forbidden (private window, site data blocked): nothing to clear.
  }
}
