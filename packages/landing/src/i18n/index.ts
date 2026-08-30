import { en } from "../content/en";
import type { Dict } from "../content/ru";
import { ru } from "../content/ru";
import { uz } from "../content/uz";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./config";

const DICTS: Record<Locale, Dict> = { ru, uz, en };

export function useTranslations(locale: Locale): Dict {
  return DICTS[locale];
}

/**
 * Достаёт язык из адреса страницы: `/uz/doctors` → `uz`, `/doctors` → `ru`.
 * Нужен компонентам, которые не получают язык пропом.
 */
export function localeFromUrl(url: URL): Locale {
  const first = url.pathname.split("/").filter(Boolean)[0];
  return (LOCALES as readonly string[]).includes(first ?? "")
    ? (first as Locale)
    : DEFAULT_LOCALE;
}

/**
 * Подстановка в строку словаря: `t(d.leadForm.doneFamily, { email })`.
 * Плейсхолдеры вида `{email}` — единственный способ вставить значение в
 * переводимый текст: конкатенация кусками ломает порядок слов в других языках.
 */
export function t(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

export { DEFAULT_LOCALE, LOCALES, type Locale };
