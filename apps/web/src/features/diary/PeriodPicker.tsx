import { buttonVariants, cn } from "@ketocare/ui";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { PeriodPreset } from "./time";
import { Field } from "../../components/Field";

const PRESETS: readonly PeriodPreset[] = ["week", "month", "custom"];

interface PeriodPickerProps {
  preset: PeriodPreset;
  onPresetChange: (preset: PeriodPreset) => void;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  /** Границы произвольного периода заданы не полностью или перепутаны */
  invalid: boolean;
}

/** Выбор периода дневника: неделя, месяц или произвольный (раздел 8.3 ТЗ). */
export function PeriodPicker({
  preset,
  onPresetChange,
  from,
  to,
  onFromChange,
  onToChange,
  invalid,
}: PeriodPickerProps) {
  const { t } = useTranslation("diary");
  const groupName = useId();
  const fromId = useId();
  const toId = useId();
  const errorId = useId();

  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-field p-0 text-sm font-medium">
        {t("period.legend")}
      </legend>

      <div className="flex flex-wrap gap-field">
        {PRESETS.map((value) => (
          <label key={value} className="cursor-pointer">
            {/* Настоящий radio, спрятанный визуально: стрелки, роль и озвучивание
                достаются от браузера, а вид задаётся соседним span. */}
            <input
              type="radio"
              name={groupName}
              value={value}
              checked={preset === value}
              onChange={() => onPresetChange(value)}
              className="peer sr-only"
            />
            {/* Вид — вариант кнопки из кита, состояние — от настоящего radio:
                своя строка классов здесь разошлась бы с кнопками экрана. */}
            <span
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-touch",
                "peer-checked:border-primary peer-checked:bg-primary peer-checked:font-semibold peer-checked:text-primary-foreground",
                "peer-checked:hover:bg-primary peer-checked:hover:text-primary-foreground",
                "peer-focus-visible:border-ring peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
              )}
            >
              {t(`period.${value}`)}
            </span>
          </label>
        ))}
      </div>

      {preset === "custom" && (
        <div className="mt-block grid gap-block sm:max-w-md sm:grid-cols-2">
          {/* Ошибка у пары дат одна на двоих — обе границы указывают на неё
              через aria-describedby, а сам текст стоит под парой. */}
          <Field
            id={fromId}
            type="date"
            label={t("period.from")}
            value={from}
            onChange={(event) => onFromChange(event.target.value)}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? errorId : undefined}
          />
          <Field
            id={toId}
            type="date"
            label={t("period.to")}
            value={to}
            onChange={(event) => onToChange(event.target.value)}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? errorId : undefined}
          />
        </div>
      )}

      {invalid && (
        <p
          id={errorId}
          role="alert"
          className="mt-field text-sm text-destructive"
        >
          {t("period.invalid")}
        </p>
      )}
    </fieldset>
  );
}
