import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import adminRu from "../locales/ru/admin.json";
import authRu from "../locales/ru/auth.json";
import calculatorRu from "../locales/ru/calculator.json";
import commonRu from "../locales/ru/common.json";
import diaryRu from "../locales/ru/diary.json";
import doctorRu from "../locales/ru/doctor.json";
import homeRu from "../locales/ru/home.json";
import menuRu from "../locales/ru/menu.json";
import productsRu from "../locales/ru/products.json";
import recipesRu from "../locales/ru/recipes.json";
import settingsRu from "../locales/ru/settings.json";

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
    admin: adminRu,
    auth: authRu,
    calculator: calculatorRu,
    diary: diaryRu,
    doctor: doctorRu,
    home: homeRu,
    menu: menuRu,
    products: productsRu,
    recipes: recipesRu,
    settings: settingsRu,
  },
} as const;

// Список пространств имён выводится из самих словарей: расхождение между
// `resources` и `ns` не ломает сборку, но экран молча показывает ключи вместо
// текста — а «ratio.label» вместо кетосоотношения читается как данные.
export const namespaces = Object.keys(resources.ru);

void i18n.use(initReactI18next).init({
  resources,
  lng: "ru",
  fallbackLng: "ru",
  defaultNS,
  ns: namespaces,
  interpolation: { escapeValue: false },
});

export default i18n;
