import { useMemo } from "react";

import { useAddressPatch, useAddressState } from "../../routes/useSectionTab";
import {
  customRange,
  presetRange,
  toDateInput,
  type DiaryRange,
  type PeriodPreset,
} from "./time";

export interface PeriodState {
  preset: PeriodPreset;
  setPreset: (preset: PeriodPreset) => void;
  /** Границы произвольного периода как в полях ввода, `YYYY-MM-DD` или пусто */
  fromInput: string;
  toInput: string;
  setFromInput: (value: string) => void;
  setToInput: (value: string) => void;
  /** null — произвольный период задан не полностью или перепутан */
  range: DiaryRange | null;
}

/**
 * Период дневника — в адресе (`?period=`, `?from=`, `?to=`), правило П1.
 *
 * В состоянии экрана период терялся при F5 и при переходе между видами
 * дневника, а ссылку «посмотрите кетоны за август» переслать было нельзя: она
 * открывала неделю. Умолчание (`fallback`) в адрес не пишется — у семьи это
 * неделя, у врача месяц, и ссылка без параметра означает умолчание экрана.
 *
 * Переход к произвольному периоду переносит в поля границы того периода,
 * который был на экране: человек правит знакомый отрезок, а не начинает с
 * пустых полей. Очищенное поле остаётся пустым — подставлять в него умолчание
 * значило бы спорить с человеком во время ввода.
 */
export function usePeriodSearch(
  fallback: Exclude<PeriodPreset, "custom">,
): PeriodState {
  const address = useAddressState();
  const patch = useAddressPatch();

  const preset: PeriodPreset = address.period ?? fallback;
  const fromInput = preset === "custom" ? (address.from ?? "") : "";
  const toInput = preset === "custom" ? (address.to ?? "") : "";

  // Границы считаются один раз на выбор: пересчёт на каждый рендер менял бы
  // ключ запроса (в нём есть «сейчас») и гонял бы список по кругу.
  const range = useMemo(
    () =>
      preset === "custom"
        ? customRange(fromInput, toInput)
        : presetRange(preset, new Date()),
    [preset, fromInput, toInput],
  );

  function setPreset(next: PeriodPreset) {
    if (next !== "custom") {
      patch({
        period: next === fallback ? undefined : next,
        from: undefined,
        to: undefined,
      });
      return;
    }
    const shown = preset === "custom" ? null : presetRange(preset, new Date());
    patch({
      period: "custom",
      from: shown === null ? address.from : toDateInput(new Date(shown.from)),
      to: shown === null ? address.to : toDateInput(new Date(shown.to)),
    });
  }

  return {
    preset,
    setPreset,
    fromInput,
    toInput,
    setFromInput: (value) => patch({ from: value === "" ? undefined : value }),
    setToInput: (value) => patch({ to: value === "" ? undefined : value }),
    range,
  };
}
