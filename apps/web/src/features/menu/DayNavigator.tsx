import { useId } from "react";
import { useTranslation } from "react-i18next";

import { formatDayLabel, isIsoDate, shiftIsoDate, todayIso } from "./dates";

interface Props {
  date: string;
  onChange: (date: string) => void;
}

/** Навигация по дням: вчера/сегодня/завтра и выбор произвольной даты. */
export function DayNavigator({ date, onChange }: Props) {
  const { t } = useTranslation("menu");
  const inputId = useId();

  const button =
    "min-h-touch min-w-touch rounded-lg border border-line px-4 text-ink";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <button
        type="button"
        onClick={() => onChange(shiftIsoDate(date, -1))}
        aria-label={t("day.previous")}
        className={button}
      >
        ‹
      </button>

      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor={inputId}>
          {t("day.label")}
        </label>
        <input
          id={inputId}
          type="date"
          value={date}
          onChange={(event) => {
            // Поле даты можно очистить или оставить неполной датой — тогда
            // выбранный день не меняется, иначе запрос ушёл бы с пустой датой.
            if (isIsoDate(event.target.value)) onChange(event.target.value);
          }}
          className="min-h-touch rounded-lg border border-line bg-surface px-3 py-2 text-ink"
        />
      </div>

      <button
        type="button"
        onClick={() => onChange(shiftIsoDate(date, 1))}
        aria-label={t("day.next")}
        className={button}
      >
        ›
      </button>

      <button
        type="button"
        onClick={() => onChange(todayIso())}
        className={button}
      >
        {t("day.today")}
      </button>

      <p className="m-0 self-center text-muted">{formatDayLabel(date)}</p>
    </div>
  );
}
