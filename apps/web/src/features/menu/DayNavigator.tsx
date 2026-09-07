import { Button } from "@ketocare/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { formatDayLabel, isIsoDate, shiftIsoDate, todayIso } from "./dates";

interface Props {
  date: string;
  onChange: (date: string) => void;
}

/** Навигация по дням: вчера/сегодня/завтра и выбор произвольной даты. */
export function DayNavigator({ date, onChange }: Props) {
  const { t } = useTranslation("menu");
  const inputId = useId();

  return (
    // Ряд управления, а не форма: нижний отступ поля здесь снимается, иначе
    // стрелки и «Сегодня» равняются на край отступа и стоят на 16 px ниже
    // самого поля. Замерено на 500 px: поле `top=254`, кнопки `top=270`.
    <div
      role="group"
      aria-label={t("day.label")}
      className="flex flex-wrap items-end gap-field [&_[data-slot=field]]:mb-0"
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="min-h-touch min-w-touch"
        onClick={() => onChange(shiftIsoDate(date, -1))}
        aria-label={t("day.previous")}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>

      <Field
        id={inputId}
        width="date"
        type="date"
        label={t("day.label")}
        value={date}
        onChange={(event) => {
          // Поле даты можно очистить или оставить неполной датой — тогда
          // выбранный день не меняется, иначе запрос ушёл бы с пустой датой.
          if (isIsoDate(event.target.value)) onChange(event.target.value);
        }}
      />

      <Button
        type="button"
        variant="outline"
        size="icon"
        className="min-h-touch min-w-touch"
        onClick={() => onChange(shiftIsoDate(date, 1))}
        aria-label={t("day.next")}
      >
        <ChevronRight aria-hidden="true" />
      </Button>

      <Button
        type="button"
        variant="outline"
        className="min-h-touch"
        onClick={() => onChange(todayIso())}
      >
        {t("day.today")}
      </Button>

      <p className="m-0 self-center text-muted-foreground">
        {formatDayLabel(date)}
      </p>
    </div>
  );
}
