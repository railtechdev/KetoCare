import { SuggestField } from "@ketocare/ui";
import { useMemo, useState, type Ref } from "react";
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
 * Механика списка — у примитива кита `SuggestField` (список в `Popover`,
 * правило П39; стрелки, Escape, выбор по `mousedown`, разметка и живая
 * область). `cmdk` для этого не годится: он перехватывает стрелки только когда
 * фокус внутри него, а фокус здесь обязан оставаться в поле — человек
 * продолжает печатать.
 *
 * **Что осталось здесь и почему.** `activeIndex` начинается с −1: поле И ЕСТЬ
 * значение, и Enter без явного выбора стрелкой не делает ничего — иначе врач,
 * открывший форму и нажавший Enter, получит в схеме лечения препарат, которого
 * не набирал. У поиска продукта то же поле — строка запроса, и там ноль: первый
 * вариант предложен. Различие видно в одной строке состояния и не спрятано в
 * параметр примитива.
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
    <SuggestField
      options={matches}
      open={isOpen}
      onOpenChange={(next) => setDismissed(!next)}
      activeIndex={activeIndex}
      onActiveIndexChange={setActiveIndex}
      onPick={pick}
      // Подстановка важнее числа найденного: она меняет то, что человек
      // набрал, и программная смена значения поля проходит молча.
      announcement={announcement}
      listLabel={t("medications.drugNameSuggestions")}
      optionKey={(match) => match.drug.id}
      renderOption={(match) => (
        <>
          <span className="min-w-0 break-words">{match.drug.name_ru}</span>
          {match.via !== null && (
            <span className="text-sm text-muted-foreground">
              {t("medications.drugNameVia", { synonym: match.via })}
            </span>
          )}
        </>
      )}
    >
      {(aria) => (
        <Field
          id={id}
          name={name}
          ref={inputRef}
          label={label}
          error={error}
          hint={t("medications.drugNameHint")}
          {...aria}
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
        />
      )}
    </SuggestField>
  );
}
