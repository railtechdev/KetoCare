import { SegmentedControl } from "@ketocare/ui";
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
  const fromId = useId();
  const toId = useId();
  const errorId = useId();

  return (
    <div className="flex flex-col gap-field">
      <div className="flex flex-wrap items-center gap-field">
        <span className="text-sm font-medium text-muted-foreground">
          {t("period.legend")}:
        </span>
        <SegmentedControl
          label={t("period.legend")}
          value={preset}
          onValueChange={onPresetChange}
          options={PRESETS.map((value) => ({
            value,
            label: t(`period.${value}`),
          }))}
        />
      </div>

      {preset === "custom" && (
        // Пара дат спрашивает ширину у своего блока (правило П33): выбор
        // периода стоит и на экране дневника, и во вкладке карты пациента.
        <div className="@container mt-section sm:max-w-md">
          <div className="grid gap-section @sm:grid-cols-2">
            {/* Ошибка у пары дат одна на двоих — обе границы указывают на неё
              через aria-describedby, а сам текст стоит под парой. */}
            <Field
              id={fromId}
              width="date"
              type="date"
              label={t("period.from")}
              value={from}
              onChange={(event) => onFromChange(event.target.value)}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? errorId : undefined}
            />
            <Field
              id={toId}
              width="date"
              type="date"
              label={t("period.to")}
              value={to}
              onChange={(event) => onToChange(event.target.value)}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? errorId : undefined}
            />
          </div>
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
    </div>
  );
}
