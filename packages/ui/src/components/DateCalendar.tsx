import { ru } from "react-day-picker/locale";
import type { ComponentProps } from "react";

import { Calendar } from "./ui/calendar";

/**
 * Календарь кита по-русски: понедельник первым, месяц и год — списками.
 *
 * Списки месяца и года нужны датам из прошлого (рождение, начало терапии):
 * листать к 2019 году по месяцу — полсотни нажатий.
 */
export function DateCalendar(props: ComponentProps<typeof Calendar>) {
  return (
    <Calendar
      locale={ru}
      weekStartsOn={1}
      captionLayout="dropdown"
      startMonth={new Date(1990, 0)}
      endMonth={new Date(new Date().getFullYear() + 2, 11)}
      {...props}
    />
  );
}
