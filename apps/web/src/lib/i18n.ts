import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import authRu from "../locales/ru/auth.json";
import calculatorRu from "../locales/ru/calculator.json";
import commonRu from "../locales/ru/common.json";

/**
 * i18n-слой (раздел 8.5 ТЗ). Язык пока один, но все пользовательские строки
 * проходят через него: захардкоженная строка в JSX — ошибка ревью (правило 8
 * CLAUDE.md), и добавление узбекской локали не должно требовать переписывания
 * компонентов.
 */
export const defaultNS = "common";

export const resources = {
  ru: {
    common: commonRu,
    auth: authRu,
    calculator: calculatorRu,
  },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: "ru",
  fallbackLng: "ru",
  defaultNS,
  ns: ["common", "auth", "calculator"],
  interpolation: { escapeValue: false },
});

export default i18n;
