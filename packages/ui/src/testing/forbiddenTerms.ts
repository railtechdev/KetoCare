import list from "./forbiddenTerms.json";

/**
 * Words that must not reach people in any channel (product audit 2026-11-12).
 *
 * The list lives in JSON so that the bot and worker tests (Python) check their
 * texts against the same words as the cabinet and the Mini App: four channels
 * once called one thing four ways.
 */
export interface ForbiddenTerm {
  pattern: RegExp;
  why: string;
}

export const FORBIDDEN_TERMS: readonly ForbiddenTerm[] = list.terms.map(
  (term) => ({ pattern: new RegExp(term.pattern, term.flags), why: term.why }),
);

/** Every string of a nested dictionary with its dotted key. */
export function dictionaryStrings(
  value: unknown,
  path = "",
  out: [string, string][] = [],
): [string, string][] {
  if (typeof value === "string") out.push([path, value]);
  else if (value !== null && typeof value === "object")
    for (const [key, child] of Object.entries(value))
      dictionaryStrings(child, path === "" ? key : `${path}.${key}`, out);
  return out;
}

/** «file:key — why» for each string that uses a forbidden term. */
export function forbiddenTermsIn(
  label: string,
  dictionary: unknown,
  terms: readonly ForbiddenTerm[] = FORBIDDEN_TERMS,
): string[] {
  const found: string[] = [];
  for (const [key, text] of dictionaryStrings(dictionary))
    for (const { pattern, why } of terms)
      if (pattern.test(text))
        found.push(`${label}:${key} — «${text.match(pattern)?.[0]}»: ${why}`);
  return found;
}
