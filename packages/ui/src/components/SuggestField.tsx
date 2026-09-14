import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "../lib/cn";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";

/**
 * Что примитив выдаёт полю: разметку combobox и обработку клавиш.
 *
 * Раскладывается прямо на `Input` кита или на `Field` приложения — поле рисует
 * вызывающая сторона, потому что у одних оно со своей подписью и подсказкой, у
 * других собрано из `Label` и `Input` вплотную к списку.
 */
export interface SuggestAria {
  role: "combobox";
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-autocomplete": "list";
  "aria-activedescendant": string | undefined;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export interface SuggestFieldProps<T> {
  /** Что показывать. Пустой список — примитив не открывается. */
  options: readonly T[];
  /**
   * Открыт ли список.
   *
   * Условие открытия считает вызывающая сторона: у поиска это «набрано два
   * знака и что-то нашлось», у поля со свободным вводом — «есть совпадения и
   * они не повторяют набранное».
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Подсвеченный вариант; −1 — не выбрано ничего.
   *
   * **Начальное значение задаёт смысл Enter, и это не мелочь.** Ноль означает
   * «первый вариант предложен»: Enter берёт его — так ведёт себя поиск, где
   * поле это строка запроса. Минус один означает «не выбрано ничего»: Enter
   * подсказку не трогает — так обязано вести себя поле, которое И ЕСТЬ
   * значение, иначе врач, открывший форму и нажавший Enter, получит в схеме
   * лечения препарат, которого не набирал.
   *
   * Различие живёт у вызывающей стороны намеренно: спрятанное в параметр
   * примитива, оно стало бы невидимым ровно там, где клинически значимо.
   */
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  /** Выбор: Enter по подсвеченному или щелчок по строке. */
  onPick: (option: T) => void;
  /**
   * Что сказать вслух.
   *
   * Живая область встроена, потому что при копировании механики её забывают:
   * появление подсказок скринридер сам не объявляет, а подстановку значения —
   * тем более.
   */
  announcement: string;
  /** Подпись списка для скринридера, когда рядом нет видимого заголовка. */
  listLabel?: string;
  optionKey: (option: T, index: number) => string;
  /** Строка списка: содержимое `li`, без разметки роли и подсветки. */
  renderOption: (option: T, index: number) => ReactNode;
  /** Поле ввода. Получает разметку combobox — разложить на сам `input`. */
  children: (aria: SuggestAria) => ReactNode;
  className?: string;
  /**
   * Дополнение к оформлению списка.
   *
   * Ширину по якорю задаёт примитив; сюда идёт только предел сверх неё — у
   * поля с ролью `wide` он тот же, что у самого поля.
   */
  contentClassName?: string;
}

/**
 * Поле со списком подсказок: общая механика, вынесенная из трёх копий.
 *
 * Копий было три (`ProductPicker`, `DishPicker`, `DrugNameField`), и они
 * разошлись в момент копирования: у третьего сначала не оказалось живой
 * области, а условие открытия не совпало с оригиналом. Здесь лежит то, что
 * обязано совпадать: позиционирование в `Popover` кита (правило П39 канона),
 * ширина по полю, разметка `ul[role=listbox] > li[role=option]`, связь поля со
 * списком через `aria-controls` и `aria-activedescendant`, ход стрелками,
 * Escape, выбор по `mousedown` и живая область.
 *
 * **Выбор идёт по `mousedown`, а не по `click`:** `click` срабатывает после
 * `blur` поля, и список успевает закрыться раньше выбора.
 *
 * Наверх не уехало то, что у трёх разное: что считать открытым состоянием, что
 * происходит с полем после выбора и что делает Enter (см. `activeIndex`).
 */
export function SuggestField<T>({
  options,
  open,
  onOpenChange,
  activeIndex,
  onActiveIndexChange,
  onPick,
  announcement,
  listLabel,
  optionKey,
  renderOption,
  children,
  className,
  contentClassName,
}: SuggestFieldProps<T>) {
  const listId = useId();
  const isOpen = open && options.length > 0;
  const anchor = useRef<HTMLDivElement>(null);

  /**
   * Поле — часть виджета, а не «снаружи».
   *
   * Radix считает внешним всё, что не содержимое всплывающего, и закрывается на
   * фокус и нажатие в поле. Для меню это верно, для combobox — нет: человек
   * печатает в поле, пока список открыт. Три копии этого не знали и держались
   * на обратном открытии по `onFocus`; стоило фокусу прийти без ввода (Tab,
   * программная установка после ошибки формы), список пропадал.
   *
   * Вешается на оба события. В jsdom их пути сходятся, и каждое по отдельности
   * измеренно избыточно — но в браузере фокус и указатель приходят разными
   * путями, и оставить один значит закрыть только половину случаев.
   */
  function keepOpenOnAnchor(event: {
    target: EventTarget | null;
    preventDefault: () => void;
  }) {
    if (anchor.current?.contains(event.target as Node)) event.preventDefault();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onActiveIndexChange((activeIndex + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      onActiveIndexChange(
        activeIndex <= 0 ? options.length - 1 : activeIndex - 1,
      );
    } else if (event.key === "Enter") {
      // Ничего не подсвечено — Enter обычный: отправляет форму, как везде.
      if (activeIndex < 0) return;
      event.preventDefault();
      const option = options[activeIndex];
      if (option !== undefined) onPick(option);
    } else if (event.key === "Escape") {
      onOpenChange(false);
    }
  }

  const aria: SuggestAria = {
    role: "combobox",
    "aria-expanded": isOpen,
    "aria-controls": listId,
    "aria-autocomplete": "list",
    "aria-activedescendant":
      isOpen && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined,
    onKeyDown: handleKeyDown,
  };

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <div className={cn("flex min-w-0 flex-col", className)}>
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>

        <PopoverAnchor asChild>
          <div className="min-w-0" ref={anchor}>
            {children(aria)}
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          sideOffset={4}
          // Ширина повторяет поле, а не задаётся заново.
          className={cn(
            "max-h-72 w-[var(--radix-popover-trigger-width)] overflow-auto p-0",
            contentClassName,
          )}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onFocusOutside={keepOpenOnAnchor}
          onInteractOutside={keepOpenOnAnchor}
        >
          <ul
            id={listId}
            role="listbox"
            aria-label={listLabel}
            className="m-0 list-none p-0"
          >
            {options.map((option, index) => (
              <li
                key={optionKey(option, index)}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  "flex min-h-touch cursor-pointer flex-col gap-field px-3 py-2",
                  index === activeIndex && "bg-accent text-accent-foreground",
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPick(option);
                }}
                onMouseEnter={() => onActiveIndexChange(index)}
              >
                {renderOption(option, index)}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </div>
    </Popover>
  );
}
