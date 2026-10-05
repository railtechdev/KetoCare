import { formatMeasured, formatWeight } from "@ketocare/ui";
import type { TFunction } from "i18next";

import type { DiaryLog } from "./useDiary";

export interface EntryNames {
  seizureTypes: ReadonlyMap<string, string>;
  durationOptions: ReadonlyMap<string, string>;
  medications: ReadonlyMap<string, string>;
}

export interface EntryDescription {
  title: string;
  lines: string[];
}

/**
 * Запись дневника простыми словами: заголовок и строки подробностей.
 *
 * Словами Mini App, а не кабинета: здесь читает бабушка с телефона, и
 * «Кетоны: 1,8 ммоль/л · по крови» ей понятнее, чем карточка, озаглавленная
 * числом. Числа печатают помощники кита (правило П45).
 */
export function describeEntry(
  entry: DiaryLog,
  names: EntryNames,
  t: TFunction,
): EntryDescription {
  switch (entry.kind) {
    case "seizures": {
      const type = names.seizureTypes.get(entry.seizure_type_id);
      return {
        title:
          type === undefined
            ? t("diary.entry.seizure")
            : t("diary.entry.seizureTyped", { type }),
        lines: compact([
          seizureDuration(entry, names, t),
          entry.count > 1
            ? t("diary.entry.count", { value: formatMeasured(entry.count) })
            : null,
          entry.description,
          entry.triggers === null
            ? null
            : t("diary.entry.triggers", { value: entry.triggers }),
        ]),
      };
    }
    case "ketones":
      return {
        title: t("diary.entry.ketones", { value: formatMeasured(entry.value) }),
        lines: [
          t(
            entry.method === "blood"
              ? "diary.entry.ketonesBlood"
              : "diary.entry.ketonesUrine",
          ),
        ],
      };
    case "weight":
      return {
        title: t("diary.entry.weight", {
          value: formatWeight(entry.weight_kg),
        }),
        lines: compact([
          entry.height_cm === null
            ? null
            : t("diary.entry.height", {
                value: formatMeasured(entry.height_cm),
              }),
        ]),
      };
    case "medications": {
      const name = names.medications.get(entry.medication_id);
      return {
        title:
          name === undefined
            ? t("diary.entry.medicationUnknown")
            : t("diary.entry.medication", { name }),
        lines: [t(entry.taken ? "diary.entry.taken" : "diary.entry.notTaken")],
      };
    }
    case "meals":
      return {
        title: t("diary.entry.meal"),
        lines: compact([
          entry.free_text,
          entry.menu_item_id === null ? null : t("diary.entry.mealFromMenu"),
        ]),
      };
    case "side-effects":
      return {
        title: t("diary.entry.sideEffect", { symptom: entry.symptom }),
        lines: compact([entry.description]),
      };
  }
}

/**
 * Длительность приступа — из того источника, который заполнен (ADR-0020).
 *
 * Интервал со слов не пересчитывается в секунды даже для показа: «от 10 до 30
 * минут», выведенные как «600 с», читались бы как засечённое секундомером.
 */
function seizureDuration(
  entry: DiaryLog & { kind: "seizures" },
  names: EntryNames,
  t: TFunction,
): string | null {
  if (entry.duration_sec !== null) {
    return t("diary.entry.durationSec", {
      value: formatMeasured(entry.duration_sec),
    });
  }
  if (entry.duration_option_id !== null) {
    return t("diary.entry.durationInterval", {
      value:
        names.durationOptions.get(entry.duration_option_id) ??
        t("diary.entry.durationUnnamed"),
    });
  }
  return null;
}

function compact(lines: (string | null)[]): string[] {
  return lines.filter(
    (line): line is string => line !== null && line.trim() !== "",
  );
}
