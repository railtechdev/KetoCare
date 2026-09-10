import { Popover, PopoverAnchor, PopoverContent } from "@ketocare/ui";
import { useId, useMemo, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import type { AedDrug } from "../intake/useIntake";

/** Совпадение препарата с набранным текстом и то, чем именно он совпал. */
export interface DrugMatch {
  drug: AedDrug;
  /** Синоним, по которому нашлось; `null` — совпало каноническое название. */
  via: string | null;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU");
}

/**
 * Сколько знаков нужно набрать, чтобы появилась подсказка.
 *
 * Столько же, сколько у поиска продукта. По одной букве список выходит
 * бессмысленно длинным, а на пустом поле его быть не должно вовсе: форма
 * препарата открывается панелью, панель ставит фокус в первое поле, и Enter
 * вписал бы первый препарат справочника, которого никто не набирал.
 */
const MIN_QUERY = 2;

/**
 * Препараты, подходящие под набранное, — по названию и по синонимам.
 *
 * Синонимы ищутся наравне с названием: «Кеппра», «Летирам» и «Леветирацетам» —
 * одно вещество, и врач набирает то написание, которое привык видеть на
 * упаковке. Найденное по синониму подписывается им же, иначе подсказка
 * выглядит подменой: набрал «Кеппра» — предлагают «Леветирацетам».
 *
 * Выведенные из употребления не предлагаются: их держат ради уже заполненных
 * анкет, а не ради новых назначений.
 */
export function matchDrugs(
  drugs: readonly AedDrug[],
  query: string,
): readonly DrugMatch[] {
  const needle = normalize(query);
  if (needle.length < MIN_QUERY) return [];
  const live = drugs.filter((drug) => !drug.retired && drug.is_drug);

  const matches: DrugMatch[] = [];
  for (const drug of live) {
    if (normalize(drug.name_ru).includes(needle)) {
      matches.push({ drug, via: null });
      continue;
    }
    const synonym = drug.synonyms.find((item) =>
      normalize(item).includes(needle),
    );
    if (synonym !== undefined) matches.push({ drug, via: synonym });
  }
  return matches;
}

/**
 * Название препарата: подсказка из справочника, но ввод остаётся свободным.
 *
 * **Список нельзя закрывать.** Справочник `aed_drugs` неполон — в нём
 * противоэпилептические препараты, а врач назначает и то, чего в нём нет.
 * Поэтому поле остаётся обычным текстовым, а справочник только предлагает
 * канонические написания.
 *
 * **Зачем это вообще.** До сих пор схему лечения набирали руками, при том что
 * анкету семьи заполняют выбором из того же справочника. Два написания одного
 * препарата в одной карте ломают подсчёт приверженности (вопрос 37) и делают
 * несравнимыми записи о приёме.
 *
 * Устроено так же, как поиск продукта в калькуляторе (`ProductPicker`), и по
 * тем же причинам: список в китовом `Popover` (правило П39), а не своя рамка на
 * `absolute` — рукописное позиционирование не умеет ни упираться в край экрана,
 * ни выходить за пределы прокручиваемого родителя, а форма препарата открывается
 * панелью. Разметка и клавиатура combobox свои: `cmdk` перехватывает стрелки
 * только когда фокус внутри него, а фокус здесь обязан оставаться в поле —
 * человек продолжает печатать.
 *
 * **Это ТРЕТИЙ рукописный выпадающий список в кабинете, и общая часть у них
 * скопирована** (`activeIndex`, `dismissed`, `onMouseDown` вместо `click`,
 * `PopoverAnchor` с шириной по якорю, разметка `ul[role=listbox]`). Сливать их
 * сегодня не стали, и вот почему: одинаковая на вид механика ведёт себя
 * по-разному в главном. У `ProductPicker` поле — строка ПОИСКА, выбор её
 * очищает, и Enter берёт первый вариант; здесь поле И ЕСТЬ значение, выбор его
 * заменяет, а Enter без явного выбора стрелкой не делает ничего — иначе врач,
 * открывший форму и нажавший Enter, получал бы в схеме лечения препарат,
 * которого не набирал. Спрятать это различие в параметр общего хука значит
 * сделать его невидимым — ровно там, где оно клинически значимо.
 *
 * Долг записан в `docs/AUDIT_UX.md`: общую часть надо унести в кит примитивом,
 * и вместе с ней — живую область, которой при копировании здесь сначала не
 * оказалось.
 */
export function DrugNameField({
  id,
  label,
  error,
  value,
  onChange,
  onBlur,
  drugs,
  name,
  inputRef,
}: {
  id: string;
  label: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  drugs: readonly AedDrug[];
  name?: string;
  /**
   * Ссылка на само поле ввода.
   *
   * Нужна react-hook-form: после неудачной отправки он ставит фокус на первое
   * поле с ошибкой, а без ссылки молча переходит к следующему — человек с
   * клавиатуры узнаёт не о той ошибке.
   */
  inputRef?: Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation("doctor");
  const listId = useId();
  // Список закрыли щелчком мимо или Escape. Само по себе условие открытия
  // производное и закрыться не может: в поле те же буквы, совпадения те же.
  const [dismissed, setDismissed] = useState(true);
  // −1 — не выбрано ничего. Enter в этом состоянии подсказку не трогает и ведёт
  // себя как обычно: подставить первый вариант за человека, который ничего не
  // выбирал, значит вписать в схему лечения чужое название.
  const [activeIndex, setActiveIndex] = useState(-1);

  const matches = useMemo(() => matchDrugs(drugs, value), [drugs, value]);
  // Точное совпадение подсказку не открывает: список из одной строки,
  // повторяющей набранное, только закрывает поле.
  const only = matches.length === 1 ? matches[0] : undefined;
  const exact =
    only !== undefined && normalize(only.drug.name_ru) === normalize(value);
  const isOpen = !dismissed && matches.length > 0 && !exact;

  // Что сказать вслух. Подстановка важнее числа найденного: она меняет то, что
  // человек набрал, и молчать о ней нельзя.
  const [substituted, setSubstituted] = useState<string | null>(null);
  const announcement =
    substituted !== null
      ? t("medications.drugNameApplied", { name: substituted })
      : isOpen
        ? t("medications.drugNameFound", { count: matches.length })
        : "";

  function pick(match: DrugMatch | undefined) {
    if (match === undefined) return;
    onChange(match.drug.name_ru);
    setDismissed(true);
    setActiveIndex(-1);
    setSubstituted(match.drug.name_ru);
  }

  return (
    <Popover open={isOpen} onOpenChange={(open) => setDismissed(!open)}>
      <PopoverAnchor asChild>
        <div className="min-w-0">
          {/* Что произошло — словами, для того, кто экрана не видит.
              Появление подсказки скринридер сам не объявляет, а подстановку
              канонического названия («Кеппра» заменилась «Леветирацетамом») —
              тем более: программная смена значения поля проходит молча. Это
              худшее место, где такое может случиться незамеченным. */}
          <span role="status" aria-live="polite" className="sr-only">
            {announcement}
          </span>
          <Field
            id={id}
            name={name}
            ref={inputRef}
            label={label}
            error={error}
            hint={t("medications.drugNameHint")}
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              isOpen ? `${listId}-${activeIndex}` : undefined
            }
            // Браузерная автоподстановка поверх своей подсказки — две разные
            // рамки в одном месте.
            autoComplete="off"
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              setActiveIndex(-1);
              setSubstituted(null);
              setDismissed(false);
            }}
            onFocus={() => setDismissed(false)}
            onBlur={onBlur}
            onKeyDown={(event) => {
              if (!isOpen) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((i) => (i + 1) % matches.length);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((i) =>
                  i <= 0 ? matches.length - 1 : (i - 1) % matches.length,
                );
              } else if (event.key === "Enter" && activeIndex >= 0) {
                // Вариант выбран стрелкой — Enter подставляет его, а не
                // отправляет форму: иначе назначение уходило бы с недонабранным
                // названием. Ничего не выбрано — Enter обычный.
                event.preventDefault();
                pick(matches[activeIndex]);
              } else if (event.key === "Escape") {
                setDismissed(true);
              }
            }}
          />
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={4}
        // Ширина повторяет поле, а не задаётся заново.
        className="max-h-72 w-[var(--radix-popover-trigger-width)] overflow-auto p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ul
          id={listId}
          role="listbox"
          aria-label={t("medications.drugNameSuggestions")}
          className="m-0 list-none p-0"
        >
          {matches.map((match, index) => (
            <li
              key={match.drug.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`flex min-h-touch cursor-pointer flex-col gap-field px-3 py-2 ${
                index === activeIndex ? "bg-accent text-accent-foreground" : ""
              }`}
              onMouseDown={(event) => {
                // mouseDown, а не click: click срабатывает после blur поля, и
                // список успевает закрыться раньше выбора.
                event.preventDefault();
                pick(match);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="min-w-0 break-words">{match.drug.name_ru}</span>
              {match.via !== null && (
                <span className="text-sm text-muted-foreground">
                  {t("medications.drugNameVia", { synonym: match.via })}
                </span>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
