import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import appRu from "../locales/ru/app.json";

/**
 * i18n-слой (раздел 8.5 ТЗ). Язык пока один, но все пользовательские строки
 * проходят через него: захардкоженная строка в JSX — ошибка ревью (правило 8
 * CLAUDE.md).
 *
 * Пространство одно: приложение — один кабинет из нескольких экранов, и делить
 * его словарь так же, как словарь большого кабинета, значит заводить разделы
 * ради разделов.
 */
export const defaultNS = "app";

export const resources = { ru: { app: appRu } } as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: "ru",
  fallbackLng: "ru",
  defaultNS,
  ns: Object.keys(resources.ru),
  interpolation: { escapeValue: false },
});

export default i18n;
