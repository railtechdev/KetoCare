import {
  Input,
  Label,
  SEARCH_DELAY_MS,
  SuggestField,
  formatKcal,
  formatRatio,
  useDebouncedValue,
} from "@ketocare/ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useDishOptions, type DishOption } from "./useDishCatalog";

interface Props {
  patientId: string | null;
  value: DishOption | null;
  onSelect: (option: DishOption | null) => void;
  /** Идентификатор сообщения об ошибке формы — связывается с полем */
  errorId?: string;
  invalid?: boolean;
}

/**
 * Выбор блюда для позиции меню: рецепт или своё блюдо, ровно одно.
 *
 * Оба источника ищутся одним полем: раздельные поля позволяли бы заполнить оба
 * сразу, а такую позицию сервер отклоняет (раздел 4.2 ТЗ) — родителю пришлось
 * бы разбираться в отказе вместо составления меню.
 *
 * Механика списка — у примитива кита `SuggestField`: разметка combobox по
 * WAI-ARIA, стрелки, Escape, выбор по `mousedown` и живая область. Здесь
 * остаётся то, что у списков разное: поле — строка ПОИСКА, поэтому
 * `activeIndex` начинается с нуля (первый вариант предложен, Enter берёт его),
 * а выбор оставляет в поле название выбранного блюда.
 *
 * Поле собрано из `Input` и `Label` кита, а не из `Field`: список подсказок
 * позиционируется относительно поля и должен стоять сразу за ним, а `Field`
 * ставит между ними подсказку и сообщение об ошибке.
 */
export function DishPicker({
  patientId,
  value,
  onSelect,
  errorId,
  invalid,
}: Props) {
  const { t } = useTranslation("menu");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);

  const inputId = useId();
  const debounced = useDebouncedValue(query, SEARCH_DELAY_MS);
  const { options, isFetching, isError, error } = useDishOptions(
    patientId,
    debounced,
  );

  const isOpen = open && options.length > 0;

  function pick(option: DishOption | undefined) {
    if (!option) return;
    onSelect(option);
    // Название остаётся в поле: выбранное блюдо должно быть видно, а не
    // исчезать вместе с введённым запросом.
    setQuery(option.title);
    setActiveIndex(0);
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-field">
      <SuggestField
        options={options}
        open={open}
        onOpenChange={setOpen}
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
        onPick={pick}
        // Состояние поиска объявляется отдельно: скринридер иначе не узнает,
        // что список обновился.
        announcement={
          isFetching
            ? t("picker.searching")
            : isOpen
              ? t("picker.optionsFound", { count: options.length })
              : ""
        }
        className="gap-field"
        optionKey={(option) => option.key}
        renderOption={(option) => (
          <div className="flex flex-wrap items-center gap-field">
            <span className="min-w-0 break-words">{option.title}</span>
            <span className="text-sm text-muted-foreground">
              {t(`item.${option.kind}`)}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {option.kcal === null
                ? t("picker.noTotals")
                : t("picker.totals", {
                    kcal: formatKcal(option.kcal),
                    ratio:
                      option.ratio === null ? "—" : formatRatio(option.ratio),
                  })}
            </span>
            {option.servings !== null && (
              <span className="text-sm text-muted-foreground tabular-nums">
                {t("picker.servings", { count: option.servings })}
              </span>
            )}
          </div>
        )}
      >
        {(aria) => (
          <div className="flex flex-col gap-field">
            <Label htmlFor={inputId}>{t("picker.label")}</Label>
            <Input
              id={inputId}
              {...aria}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={errorId}
              className="min-h-touch"
              placeholder={t("picker.placeholder")}
              value={query}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
                setOpen(true);
                // Правка текста отменяет выбор: иначе в меню ушло бы блюдо, которого
                // в поле уже не видно.
                if (value !== null) onSelect(null);
              }}
            />
          </div>
        )}
      </SuggestField>

      {isError && (
        <p className="m-0 text-sm break-words text-destructive" role="alert">
          {errorMessageOf(error) ?? t("picker.failed")}
        </p>
      )}

      <p className="m-0 text-sm text-muted-foreground">
        {value !== null
          ? t(`item.${value.kind}`)
          : query.trim().length >= 2 && !isFetching && !isOpen
            ? t("picker.nothingFound")
            : t("picker.hint")}
      </p>
    </div>
  );
}
