/**
 * Языки сайта и правила адресации.
 *
 * Русский — язык по умолчанию и лежит в корне (`/`, `/doctors`), остальные —
 * с префиксом (`/uz/`, `/en/doctors`). Так у главного языка адреса без
 * лишнего сегмента, а hreflang всё равно перечисляет все три версии.
 */

export const LOCALES = ["ru", "uz", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ru";

/** Значение атрибута `lang` и `hreflang`: BCP 47, а не наш внутренний код. */
export const HTML_LANG: Record<Locale, string> = {
  ru: "ru",
  uz: "uz-Latn-UZ",
  en: "en",
};

/** Подпись языка в переключателе — всегда на самом этом языке. */
export const LOCALE_LABEL: Record<Locale, string> = {
  ru: "Русский",
  uz: "O‘zbekcha",
  en: "English",
};

/** Короткая подпись для узкого экрана. */
export const LOCALE_SHORT: Record<Locale, string> = {
  ru: "RU",
  uz: "UZ",
  en: "EN",
};

/** Страницы сайта: ключ → путь без языкового префикса. */
export const PAGES = {
  home: "",
  howItWorks: "how-it-works",
  doctors: "doctors",
} as const;

export type PageKey = keyof typeof PAGES;

/**
 * Абсолютный путь страницы на заданном языке — единственное место, где
 * собирается адрес. Ссылки, hreflang, sitemap и переключатель языка обязаны
 * пользоваться им, иначе языковые версии однажды разъедутся.
 */
export function pagePath(page: PageKey, locale: Locale): string {
  const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
  const slug = PAGES[page];
  // Косая черта в конце обязательна: сборка идёт в режиме `directory`, и
  // адрес страницы — именно `/doctors/`. Без неё canonical и hreflang
  // указывали бы на `/doctors`, а sitemap — на `/doctors/`, то есть на два
  // разных адреса с одинаковым содержимым.
  return slug === "" ? `${prefix}/` : `${prefix}/${slug}/`;
}

/** Языки, кроме заданного, — для переключателя. */
export function otherLocales(locale: Locale): Locale[] {
  return LOCALES.filter((l) => l !== locale);
}
