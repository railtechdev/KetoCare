import { createContext, useContext } from "react";

/**
 * Подписи предметных компонентов кита — из словаря приложения.
 *
 * `MacroBar`, `MacroFacts`, `RatioBadge` и `DiaryEntryCard` стоят в двух
 * каналах, а Mini App говорит на двух языках (ADR-0052). Пока подписи жили в
 * компонентах литералами, узбекская семья видела «Жиры · Белки · Углеводы» и
 * «ккал» посреди экрана на латинице, а программа чтения с экрана произносила
 * русскую подпись соотношения узбекским голосом.
 *
 * Поэтому кит слов не знает: приложение собирает их из своего i18n и кладёт в
 * `KitLabelsProvider` один раз у корня. Без поставщика остаются русские
 * подписи ниже — это умолчание для витрины и тестов, а не путь для экранов:
 * оба приложения поставщика ставят.
 *
 * Значения — уже готовые строки и функции, а не ключи: у кита нет i18n, и
 * подстановка числа в фразу («Соотношение 3.9 : 1, соответствует назначению»)
 * делается словарём приложения со своими правилами порядка слов.
 */
export interface KitLabels {
  macros: {
    fat: string;
    protein: string;
    carbs: string;
    /** Подписи ячеек `MacroFacts` для вспомогательной технологии */
    kcalFull: string;
    fatFull: string;
    proteinFull: string;
    carbsFull: string;
    /** Сокращения ячеек `MacroFacts` — глазу */
    fatShort: string;
    proteinShort: string;
    carbsShort: string;
    /** Единицы после числа */
    gramsUnit: string;
    kcalUnit: string;
  };
  ratio: {
    unknown: string;
    /** Подпись соотношения без вердикта; `value` уже отформатировано */
    plain: (value: string) => string;
    within: (value: string) => string;
    off: (value: string) => string;
  };
  diarySource: {
    web: string;
    bot: string;
    miniapp: string;
    ai_parsed: string;
  };
}

export const DEFAULT_KIT_LABELS: KitLabels = {
  macros: {
    fat: "Жиры",
    protein: "Белки",
    carbs: "Углеводы",
    kcalFull: "Калорийность, ккал",
    fatFull: "Жиры, г",
    proteinFull: "Белки, г",
    carbsFull: "Углеводы, г",
    fatShort: "Ж",
    proteinShort: "Б",
    carbsShort: "У",
    gramsUnit: "г",
    kcalUnit: "ккал",
  },
  ratio: {
    unknown: "Соотношение не определено",
    plain: (value) => `Соотношение ${value}`,
    within: (value) => `Соотношение ${value}, соответствует назначению`,
    off: (value) => `Соотношение ${value}, отклоняется от назначения`,
  },
  diarySource: {
    web: "Веб",
    bot: "Бот",
    miniapp: "Приложение",
    ai_parsed: "Распознано ИИ",
  },
};

/** Ставит `KitLabelsProvider` (`components/KitLabelsProvider.tsx`). */
export const KitLabelsContext = createContext<KitLabels>(DEFAULT_KIT_LABELS);

export function useKitLabels(): KitLabels {
  return useContext(KitLabelsContext);
}

/** Перевод по ключу — `t` из react-i18next, уже привязанный к пространству. */
export type KitTranslate = (
  key: string,
  values?: Record<string, string>,
) => string;

/**
 * Подписи кита из словаря приложения: ключи `kit.macros.*`, `kit.ratio.*`,
 * `kit.diarySource.*`. Одна сборка на оба приложения — иначе каждое собирало
 * бы объект по-своему, и новая подпись кита однажды осталась бы русской в
 * одном из них.
 */
export function kitLabelsFrom(t: KitTranslate): KitLabels {
  const macro = (name: keyof KitLabels["macros"]) => t(`kit.macros.${name}`);
  const source = (name: keyof KitLabels["diarySource"]) =>
    t(`kit.diarySource.${name}`);
  return {
    macros: {
      fat: macro("fat"),
      protein: macro("protein"),
      carbs: macro("carbs"),
      kcalFull: macro("kcalFull"),
      fatFull: macro("fatFull"),
      proteinFull: macro("proteinFull"),
      carbsFull: macro("carbsFull"),
      fatShort: macro("fatShort"),
      proteinShort: macro("proteinShort"),
      carbsShort: macro("carbsShort"),
      gramsUnit: macro("gramsUnit"),
      kcalUnit: macro("kcalUnit"),
    },
    ratio: {
      unknown: t("kit.ratio.unknown"),
      plain: (value) => t("kit.ratio.plain", { value }),
      within: (value) => t("kit.ratio.within", { value }),
      off: (value) => t("kit.ratio.off", { value }),
    },
    diarySource: {
      web: source("web"),
      bot: source("bot"),
      miniapp: source("miniapp"),
      ai_parsed: source("ai_parsed"),
    },
  };
}
