import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { PeriodPreset } from "./time";
import { FIELD_CONTROL } from "../../components/Field";

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
      <legend className="mb-2 p-0 text-sm font-medium">
        {t("period.legend")}
      </legend>

      <div className="flex flex-wrap gap-2">
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
            <span className="flex min-h-touch items-center rounded-lg border border-border px-4 text-foreground peer-checked:border-primary peer-checked:bg-primary peer-checked:font-semibold peer-checked:text-primary-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary">
              {t(`period.${value}`)}
            </span>
          </label>
        ))}
      </div>

      {preset === "custom" && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2 sm:max-w-md">
          <div>
            <label
              className="mb-1.5 block text-sm font-medium"
              htmlFor={fromId}
            >
              {t("period.from")}
            </label>
            <input
              id={fromId}
              type="date"
              value={from}
              onChange={(event) => onFromChange(event.target.value)}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? errorId : undefined}
              className={FIELD_CONTROL}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor={toId}>
              {t("period.to")}
            </label>
            <input
              id={toId}
              type="date"
              value={to}
              onChange={(event) => onToChange(event.target.value)}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? errorId : undefined}
              className={FIELD_CONTROL}
            />
          </div>
        </div>
      )}

      {invalid && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-destructive">
          {t("period.invalid")}
        </p>
      )}
    </fieldset>
  );
}
