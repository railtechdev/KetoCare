import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { useProductSearch, type ProductOption } from "./useProducts";
import { FIELD_CONTROL } from "../../components/Field";

interface Props {
  onPick: (product: ProductOption) => void;
  /** Уже добавленные продукты не предлагаются повторно */
  excludeIds: string[];
}

/**
 * Поиск продукта с автодополнением (раздел 8.3 ТЗ).
 *
 * Разметка combobox по WAI-ARIA: поле связано со списком через aria-controls,
 * активный вариант — через aria-activedescendant. Без этого пользователь
 * скринридера не узнает ни о появлении подсказок, ни о выбранном варианте.
 */
export function ProductPicker({ onPick, excludeIds }: Props) {
  const { t } = useTranslation("calculator");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const listId = useId();
  const inputId = useId();
  const { data, isFetching } = useProductSearch(query);

  const options = (data ?? []).filter((p) => !excludeIds.includes(p.id));
  const isOpen = query.trim().length >= 2 && options.length > 0;

  function pick(product: ProductOption | undefined) {
    if (!product) return;
    onPick(product);
    setQuery("");
    setActiveIndex(0);
  }

  return (
    <div className="relative">
      <label className="mb-1.5 block text-sm font-medium" htmlFor={inputId}>
        {t("addProduct")}
      </label>
      <input
        id={inputId}
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={isOpen ? `${listId}-${activeIndex}` : undefined}
        className={FIELD_CONTROL}
        placeholder={t("searchPlaceholder")}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (!isOpen) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((i) => (i + 1) % options.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((i) => (i - 1 + options.length) % options.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            pick(options[activeIndex]);
          } else if (event.key === "Escape") {
            setQuery("");
          }
        }}
      />

      {/* Состояние поиска объявляется отдельно: скринридер иначе не узнает,
          что список обновился. */}
      <span className="sr-only" role="status">
        {isFetching
          ? t("searching")
          : isOpen
            ? t("optionsFound", { count: options.length })
            : ""}
      </span>

      {isOpen && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line bg-surface shadow-kc"
        >
          {options.map((product, index) => (
            <li
              key={product.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`min-h-touch cursor-pointer px-3 py-2 ${
                index === activeIndex ? "bg-canvas" : ""
              }`}
              onMouseDown={(event) => {
                // mouseDown, а не click: click срабатывает после blur поля,
                // и список успевает закрыться раньше выбора.
                event.preventDefault();
                pick(product);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span>{product.name}</span>
              <span className="ml-2 text-sm text-muted tabular-nums">
                {t("per100g", {
                  kcal: product.kcal.toFixed(0),
                  fat: product.fat.toFixed(1),
                  protein: product.protein.toFixed(1),
                  carbs: product.carbs.toFixed(1),
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
