import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { setFormatLanguage } from "@ketocare/ui";

import appRu from "../locales/ru/app.json";
import appUz from "../locales/uz/app.json";
import { telegramLanguageCode } from "./telegram";

/**
 * i18n-слой (раздел 8.5 ТЗ): русский и узбекский (ADR-0052, решение G3).
 *
 * Все пользовательские строки проходят через словарь: захардкоженная строка в
 * JSX — ошибка ревью (правило 8 CLAUDE.md). Узбекский словарь обязан содержать
 * каждый русский ключ с теми же подстановками — это держит
 * `locales/locales.test.ts`; иначе узбекская семья увидела бы ключ вместо
 * текста.
 *
 * Пространство одно: приложение — один кабинет из нескольких экранов, и делить
 * его словарь так же, как словарь большого кабинета, значит заводить разделы
 * ради разделов.
 */
export const defaultNS = "app";

export const LANGUAGES = ["ru", "uz"] as const;
export type Language = (typeof LANGUAGES)[number];

export const resources = {
  ru: { app: appRu },
  uz: { app: appUz },
} as const;

/** Значение языка из ответа сервера или Telegram — или `null`, если незнакомое. */
export function knownLanguage(value: unknown): Language | null {
  return value === "ru" || value === "uz" ? value : null;
}

/**
 * Умолчание по языку клиента Telegram: узбекский — узбекский, прочее — русский.
 * Правило то же, что у сервера и бота (`core.languages.from_telegram`).
 */
export function languageFromTelegram(
  code: string | null | undefined,
): Language {
  return code?.trim().toLowerCase().split("-")[0] === "uz" ? "uz" : "ru";
}

/** Язык экрана, чисел и атрибута `lang` — одним вызовом, чтобы они не разошлись. */
export function applyLanguage(language: Language): void {
  setFormatLanguage(language);
  if (typeof document !== "undefined") {
    // Программа чтения с экрана выбирает произношение по `lang`: узбекский
    // текст, прочитанный русским голосом, непонятен (WCAG 3.1.1).
    document.documentElement.lang = language === "uz" ? "uz-Latn" : "ru";
  }
  if (i18n.language !== language) void i18n.changeLanguage(language);
}

export function currentLanguage(): Language {
  return knownLanguage(i18n.language) ?? "ru";
}

/**
 * Язык до входа — по клиенту Telegram. Зовёт `main.tsx` один раз до первой
 * отрисовки; после входа его заменяет язык с сервера (`useSession`).
 *
 * Не при импорте модуля: тогда язык экрана зависел бы от порядка импортов, а
 * тесты, подменяющие `lib/telegram`, ломались бы на чтении строки запуска.
 */
export function applyTelegramLanguage(): void {
  applyLanguage(languageFromTelegram(telegramLanguageCode()));
}

void i18n.use(initReactI18next).init({
  resources,
  lng: "ru",
  fallbackLng: "ru",
  defaultNS,
  ns: Object.keys(resources.ru),
  interpolation: { escapeValue: false },
});

export default i18n;
