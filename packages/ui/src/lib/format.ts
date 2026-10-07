/** Форматирование значений дизайн-системы.
 *
 * Отдельно от компонентов: файл, экспортирующий и компонент, и функцию, ломает
 * гранулярность fast refresh, а сами функции нужны и без React (тесты, расчёты).
 */

/**
 * Язык записи дат с названием месяца (ADR-0052).
 *
 * Mini App говорит по-русски или по-узбекски, кабинет — только по-русски. Язык
 * ставит приложение — один раз при входе и при смене языка; помощники берут его
 * отсюда, а не из параметра, который забыли бы в одном из сотни мест.
 *
 * **Числа языка не берут вовсе** — они всегда записываются локалью `ru-RU`
 * (`NUMBER_LOCALE`). У узбекского те же разделители («12 345,6»), но во
 * встроенном браузере Telegram бывает `Intl` без данных для `uz`: тогда он
 * молча переходит на локаль устройства и печатает «1,200 kkal» и «3.2» —
 * «1,200» читается как «одна целая две десятых». Для клинических чисел такой
 * риск не окупается ничем.
 */
export type FormatLanguage = "ru" | "uz";

/** BCP 47: узбекский — латиницей, как на посадочной странице (`uz-Latn-UZ`). */
const LOCALE_TAGS: Record<FormatLanguage, string> = {
  ru: "ru-RU",
  uz: "uz-Latn-UZ",
};

/** Все числа — одной записью на обоих языках (см. выше). */
const NUMBER_LOCALE = "ru-RU";

let activeLanguage: FormatLanguage = "ru";

export function setFormatLanguage(language: FormatLanguage): void {
  activeLanguage = language;
}

/**
 * Тег локали для `Intl` — только для дат с названием месяца.
 *
 * Нет у среды данных для узбекского — русский: месяц по-русски понятнее, чем
 * месяц на языке устройства, который `Intl` подставил бы молча.
 */
export function formatLocale(): string {
  const tag = LOCALE_TAGS[activeLanguage];
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0
      ? tag
      : LOCALE_TAGS.ru;
  } catch {
    return LOCALE_TAGS.ru;
  }
}

/**
 * Цифровые даты («05.10.2026, 14:30») пишутся через точку на обоих языках.
 *
 * Узбекская локаль `Intl` даёт «05/10/2026», а в Узбекистане и в подсказках
 * бота («29.08 21:00») дату пишут через точку. Даты с названием месяца берут
 * язык (`formatLocale`): там разница настоящая — «5-oktabr» против «5 октября».
 */
const NUMERIC_DATE_LOCALE = "ru-RU";

/** Формат раздела 8.2 ТЗ: «3.9 : 1». */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(1)} : 1`;
}

/**
 * Масса тела в русской записи, без округления сотых.
 *
 * `weight_logs.weight_kg` хранится как `Numeric(5, 2)`, и показать взвешенные
 * 8,25 кг как «8,3» значит потерять на экране то, что измерили: по массе
 * считают калорийность и белок на килограмм. Нулей к целому не дописывает —
 * «18,00 кг» выглядит точнее, чем есть.
 *
 * Отдельно от `formatAmount` именно из-за этого: у макронутриентов один знак
 * нужен для сравнения соседних строк глазом, у массы тела важнее не соврать.
 */
export function formatWeight(kg: number): string {
  return formatMeasured(kg);
}

/**
 * Любая величина, СНЯТАЯ ПРИБОРОМ: масса тела, кетоны, рост.
 *
 * Сохранённая точность без дописанных нулей — правило П45 для этого класса.
 * Показать взвешенные 8,25 кг как «8,3» значит потерять на экране то, что
 * измерили; дописать «3,50» к прочитанным на полоске 3,5 — наоборот, обещать
 * точность, которой не было.
 *
 * Одна реализация на все такие величины намеренно. До 18.09.2026 через неё шла
 * только масса тела, а кетоны печатались сырым числом — и «3.5 ммоль/л» через
 * точку стояло на главной семьи рядом с «18,16 кг» через запятую. Правило П45
 * кетоны называет прямо; не звал их только код.
 */
export function formatMeasured(value: number): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Множитель порции: «1,5» и «1», без дописанных нулей.
 *
 * Не измерение и не масса — поэтому своё имя. В ките, а не на экране, по той же
 * причине, что и остальные: своё `Intl.NumberFormat` на месте однажды разойдётся
 * с соседним (два таких уже назывались `AMOUNT` и отличались точностью).
 */
export function formatFactor(value: number): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Число в русской записи с заданным знаком после запятой.
 *
 * Основание для всех остальных: `toFixed` возвращает английскую запись, и
 * «4.0 г» оказывалось рядом с «4,0 г» из соседнего блока — про одно и то же
 * (правило П45 канона).
 */
export function formatNumber(value: number, digits: number): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * Граммы, которые СРАВНИВАЮТ: жиры, белки, углеводы в строке, итоги рядом с
 * целью.
 *
 * Знак после запятой всегда, даже нулевой: «50,0» рядом с «4,5» читается как
 * пара чисел, «50» рядом с «4,5» — как разнобой.
 */
export function formatGrams(value: number): string {
  return formatNumber(value, 1);
}

/**
 * Граммы, которые ЧИТАЮТ: масса продукта в составе, граммовка в плане дня.
 *
 * Целые остаются целыми — «50 г масла» не нуждается в нуле после запятой, а
 * список того, что взвесить, читают по одной строке, а не столбцом.
 */
export function formatMass(value: number): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Разовая доза препарата числом: «2,5», «0,125», «1500».
 *
 * До трёх знаков после запятой — столько хранит сервер (`Numeric(10, 3)`), и
 * «0,125 мг» нельзя показать как «0,13». Без разделителя разрядов: число
 * стоит в поле ввода, и врач правит его как написанное, а не как сводку.
 * Строку «300 мг» для чтения собирает сервер (ADR-0049).
 */
export function formatDose(value: number): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    maximumFractionDigits: 3,
    useGrouping: false,
  }).format(value);
}

/**
 * Калорийность: целое число с русским разделителем разрядов.
 *
 * Суточная норма — четырёхзначная, и «1200 ккал» читается хуже, чем «1 200».
 */
export function formatKcal(value: number): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    maximumFractionDigits: 0,
  }).format(value);
}

/** Дата и время записи дневника в локали пациента. */
export function formatOccurredAt(value: Date): string {
  return new Intl.DateTimeFormat(NUMERIC_DATE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

/**
 * День и месяц цифрами: «05.10». Для подписей оси графика за месяц — год там
 * шум, а места на телефоне мало. Цифры через точку на обоих языках, как и у
 * остальных цифровых дат (см. `NUMERIC_DATE_LOCALE`): `toLocaleDateString` на
 * месте брал бы локаль устройства или языка и печатал «05/10».
 */
export function formatDayMonth(value: Date): string {
  return new Intl.DateTimeFormat(NUMERIC_DATE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
  }).format(value);
}

/**
 * «Когда правили» без года: «05.10, 14:30».
 *
 * Для отметок о недавнем действии — кто и когда составил план дня (ADR-0047).
 * Год рядом с днём, который и так стоит на экране, только удлиняет строку. Одна
 * функция на кабинет и Mini App: семья видит одну и ту же отметку в двух местах.
 */
export function formatDayTime(value: Date): string {
  return new Intl.DateTimeFormat(NUMERIC_DATE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
