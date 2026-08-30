import { Button, ErrorState } from "@ketocare/ui";
import { PackageSearch } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { SectionLink } from "../../components/SectionLink";
import { errorMessageOf } from "../../lib/api";
import { useProductSearch, type ProductOption } from "./useProducts";

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
  const { data, isFetching, isError, error, refetch } = useProductSearch(query);

  const options = (data ?? []).filter((p) => !excludeIds.includes(p.id));
  const isOpen = query.trim().length >= 2 && options.length > 0;
  // Упавший поиск без сообщения неотличим от «ничего не нашлось»: подсказок
  // нет в обоих случаях. Показываем ошибку с повтором (П15 канона).
  const searchFailed = isError && query.trim().length >= 2;

  // «Ничего не нашлось» и «ещё ищем» на экране выглядели одинаково — никак:
  // список просто не появлялся. Семья у плиты не понимала, продолжать ли
  // ждать, и повторяла запрос по буквам. Ответ нужен явный, и вместе с ним —
  // выход: справочник по тому же слову, где видно, что продукта нет вовсе, а
  // не что опечатка в наборе.
  const nothingFound =
    query.trim().length >= 2 && !isFetching && !isError && options.length === 0;

  function pick(product: ProductOption | undefined) {
    if (!product) return;
    onPick(product);
    setQuery("");
    setActiveIndex(0);
  }

  return (
    <div className="relative">
      <Field
        id={inputId}
        label={t("addProduct")}
        width="wide"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={isOpen ? `${listId}-${activeIndex}` : undefined}
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

      {nothingFound && (
        <div
          role="status"
          className="mt-field flex flex-wrap items-center gap-field text-sm text-muted-foreground"
        >
          <PackageSearch aria-hidden="true" className="size-4 shrink-0" />
          <span>{t("noMatches", { query: query.trim() })}</span>
          <Button asChild variant="outline" size="sm" className="min-h-touch">
            <SectionLink section="products" query={query.trim()}>
              {t("openCatalog")}
            </SectionLink>
          </Button>
        </div>
      )}

      {searchFailed && (
        <ErrorState
          className="mt-field"
          title={t("searchError")}
          description={errorMessageOf(error) ?? t("common:errors.unexpected")}
          retryLabel={t("common:actions.retry")}
          onRetry={() => void refetch()}
        />
      )}

      {isOpen && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-card shadow-kc"
        >
          {options.map((product, index) => (
            <li
              key={product.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`flex min-h-touch cursor-pointer flex-wrap items-center gap-x-field px-3 py-2 ${
                index === activeIndex ? "bg-accent text-accent-foreground" : ""
              }`}
              onMouseDown={(event) => {
                // mouseDown, а не click: click срабатывает после blur поля,
                // и список успевает закрыться раньше выбора.
                event.preventDefault();
                pick(product);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="min-w-0 break-words">{product.name}</span>
              <span className="text-sm text-muted-foreground tabular-nums">
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
