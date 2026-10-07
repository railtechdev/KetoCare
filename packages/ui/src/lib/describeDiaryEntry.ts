import { formatMeasured, formatWeight } from "./format";

/**
 * Запись дневника словами: заголовок и строки подробностей.
 *
 * Живёт в ките рядом с `diaryEntry.ts`, потому что одну и ту же запись читают
 * два канала — семья в Mini App и специалист в кабинете. Пока описаний было
 * два, они разошлись в правиле, которое важно врачу: какой источник
 * длительности приступа показывать (ADR-0020). Слова у каналов свои — их даёт
 * словарь приложения через `t` с ключами `entry.*`, — а что и в каком порядке
 * показывать, решается здесь одним местом.
 *
 * Числа печатают помощники кита (правило П45).
 */

/** Только поля, которые описание читает: типы ответов API им удовлетворяют. */
export type DescribableDiaryEntry =
  | {
      kind: "seizures";
      seizure_type_id: string;
      duration_sec: number | null;
      duration_option_id: string | null;
      count: number;
      description: string | null;
      triggers: string | null;
    }
  | { kind: "ketones"; value: number; method: "blood" | "urine" }
  | { kind: "weight"; weight_kg: number; height_cm: number | null }
  | { kind: "medications"; medication_id: string; taken: boolean }
  | { kind: "meals"; free_text: string | null; menu_item_id: string | null }
  | { kind: "side-effects"; symptom: string; description: string | null };

export interface DiaryEntryNames {
  seizureTypes: ReadonlyMap<string, string>;
  durationOptions: ReadonlyMap<string, string>;
  medications: ReadonlyMap<string, string>;
}

export interface DiaryEntryDescription {
  title: string;
  lines: string[];
}

/** Перевод ключа `entry.*` словарём приложения. */
export type DiaryEntryTranslate = (
  key: string,
  values?: Record<string, string>,
) => string;

export function describeDiaryEntry(
  entry: DescribableDiaryEntry,
  names: DiaryEntryNames,
  t: DiaryEntryTranslate,
): DiaryEntryDescription {
  switch (entry.kind) {
    case "seizures": {
      const type = names.seizureTypes.get(entry.seizure_type_id);
      return {
        title:
          type === undefined
            ? t("entry.seizure")
            : t("entry.seizureTyped", { type }),
        lines: compact([
          seizureDuration(entry, names, t),
          // Один приступ — умолчание записи, и строка «1 раз» под каждой
          // карточкой только отодвигала то, что отличает запись от соседних.
          entry.count > 1
            ? t("entry.count", { value: formatMeasured(entry.count) })
            : null,
          entry.description,
          entry.triggers === null
            ? null
            : t("entry.triggers", { value: entry.triggers }),
        ]),
      };
    }
    case "ketones":
      return {
        title: t("entry.ketones", { value: formatMeasured(entry.value) }),
        lines: [
          t(
            entry.method === "blood"
              ? "entry.ketonesBlood"
              : "entry.ketonesUrine",
          ),
        ],
      };
    case "weight":
      return {
        title: t("entry.weight", { value: formatWeight(entry.weight_kg) }),
        lines: compact([
          entry.height_cm === null
            ? null
            : t("entry.height", { value: formatMeasured(entry.height_cm) }),
        ]),
      };
    case "medications": {
      const name = names.medications.get(entry.medication_id);
      return {
        title:
          name === undefined
            ? t("entry.medicationUnknown")
            : t("entry.medication", { name }),
        lines: [t(entry.taken ? "entry.taken" : "entry.notTaken")],
      };
    }
    case "meals":
      return {
        title: t("entry.meal"),
        lines: compact([
          entry.free_text,
          entry.menu_item_id === null ? null : t("entry.mealFromMenu"),
        ]),
      };
    case "side-effects":
      return {
        title: t("entry.sideEffect", { symptom: entry.symptom }),
        lines: compact([entry.description]),
      };
  }
}

/**
 * Длительность приступа — из того источника, который заполнен (ADR-0020).
 *
 * Интервал со слов не пересчитывается в секунды даже для показа: «от 10 до 30
 * минут», выведенные как «600 с», читались бы как засечённое секундомером.
 * Названия варианта может не оказаться (справочник не загрузился) — тогда
 * честнее сказать «указано словами», чем промолчать: ответ семьи есть.
 */
function seizureDuration(
  entry: DescribableDiaryEntry & { kind: "seizures" },
  names: DiaryEntryNames,
  t: DiaryEntryTranslate,
): string | null {
  if (entry.duration_sec !== null) {
    return t("entry.durationSec", {
      value: formatMeasured(entry.duration_sec),
    });
  }
  if (entry.duration_option_id !== null) {
    return t("entry.durationInterval", {
      value:
        names.durationOptions.get(entry.duration_option_id) ??
        t("entry.durationUnnamed"),
    });
  }
  return null;
}

function compact(lines: (string | null)[]): string[] {
  return lines.filter(
    (line): line is string => line !== null && line.trim() !== "",
  );
}

/** Ключи словаря, которые описание читает: приложение обязано дать каждый. */
export const DIARY_ENTRY_KEYS = [
  "entry.seizure",
  "entry.seizureTyped",
  "entry.durationSec",
  "entry.durationInterval",
  "entry.durationUnnamed",
  "entry.count",
  "entry.triggers",
  "entry.ketones",
  "entry.ketonesBlood",
  "entry.ketonesUrine",
  "entry.weight",
  "entry.height",
  "entry.medication",
  "entry.medicationUnknown",
  "entry.taken",
  "entry.notTaken",
  "entry.meal",
  "entry.mealFromMenu",
  "entry.sideEffect",
] as const;
