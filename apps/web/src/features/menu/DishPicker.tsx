import { formatRatio } from "@ketocare/ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
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
 * Разметка combobox по WAI-ARIA: поле связано со списком через aria-controls,
 * активный вариант — через aria-activedescendant. Без этого пользователь
 * скринридера не узнает ни о появлении подсказок, ни о выбранном варианте.
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

  const listId = useId();
  const inputId = useId();
  const debounced = useDebouncedValue(query, 300);
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
    <div className="relative">
      <label className="mb-1.5 block text-sm font-medium" htmlFor={inputId}>
        {t("picker.label")}
      </label>
      <input
        id={inputId}
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={isOpen ? `${listId}-${activeIndex}` : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={errorId}
        className={`min-h-touch w-full rounded-lg border bg-card px-3 py-2.5 text-foreground ${
          invalid ? "border-destructive" : "border-border"
        }`}
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
        onKeyDown={(event) => {
          if (!isOpen) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % options.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex(
              (index) => (index - 1 + options.length) % options.length,
            );
          } else if (event.key === "Enter") {
            event.preventDefault();
            pick(options[activeIndex]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />

      {/* Состояние поиска объявляется отдельно: скринридер иначе не узнает,
          что список обновился. */}
      <span className="sr-only" role="status">
        {isFetching
          ? t("picker.searching")
          : isOpen
            ? t("picker.optionsFound", { count: options.length })
            : ""}
      </span>

      {isOpen && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-card shadow-kc"
        >
          {options.map((option, index) => (
            <li
              key={option.key}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`min-h-touch cursor-pointer px-3 py-2 ${
                index === activeIndex ? "bg-background" : ""
              }`}
              onMouseDown={(event) => {
                // mouseDown, а не click: click срабатывает после blur поля,
                // и список успевает закрыться раньше выбора.
                event.preventDefault();
                pick(option);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span>{option.title}</span>
              <span className="ml-2 text-sm text-muted-foreground">
                {t(`item.${option.kind}`)}
              </span>
              <span className="ml-2 text-sm text-muted-foreground tabular-nums">
                {option.kcal === null
                  ? t("picker.noTotals")
                  : t("picker.totals", {
                      kcal: option.kcal.toFixed(0),
                      ratio:
                        option.ratio === null ? "—" : formatRatio(option.ratio),
                    })}
              </span>
              {option.servings !== null && (
                <span className="ml-2 text-sm text-muted-foreground tabular-nums">
                  {t("picker.servings", { count: option.servings })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {isError && (
        <p className="mt-1 text-sm text-destructive" role="alert">
          {errorMessageOf(error) ?? t("picker.failed")}
        </p>
      )}

      <p className="mt-1 text-sm text-muted-foreground">
        {value !== null
          ? t(`item.${value.kind}`)
          : query.trim().length >= 2 && !isFetching && !isOpen
            ? t("picker.nothingFound")
            : t("picker.hint")}
      </p>
    </div>
  );
}
