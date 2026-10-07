/**
 * Параметры адреса кабинета и их проверка.
 *
 * Вынесены из `router.tsx`, чтобы тестовые роутеры (`test/SectionRouter.tsx`,
 * `test/PatientRouter.tsx`) проверяли адрес той же функцией, что и боевой:
 * тест, принимающий любой параметр как есть, не заметил бы, что боевой маршрут
 * его выбрасывает.
 */
/**
 * Один параметризованный маршрут вместо набора статических: список разделов
 * зависит от роли, и генерация путей строками обходила бы типизацию роутера.
 */
export interface SectionSearch extends ViewStateSearch, FilterSearch {
  /** Выбранный ребёнок. В адресе, а не в состоянии: ссылка на экран должна
      однозначно говорить, о ком она, — иначе присланная врачу или второму
      родителю ссылка откроет данные другого ребёнка. */
  patient?: string;
  /** Вкладка экрана: параллельные виды одного объекта (правило П30 канона). */
  tab?: string;
  /** Разновидность внутри вкладки: вид дневника, выбранный справочник. */
  kind?: string;
  /**
   * Объект или задача второго уровня внутри раздела: открытый продукт
   * (`item=<id>`), заведение новой позиции (`item=new`), импорт
   * (`item=import`).
   *
   * В адресе, а не в состоянии экрана: правило П1 канона требует адрес у
   * каждого объекта второго уровня. Пока параметра не было, администратор,
   * правивший продукт, не мог ни переслать ссылку коллеге, ни обновить
   * страницу — F5 возвращал в список, а «Назад» браузера уводил из раздела.
   */
  item?: string;
  /**
   * Задача сборки PDF-отчёта.
   *
   * В адресе, а не в состоянии экрана: сборка идёт в воркере секундами, и до
   * этого параметра её идентификатор терялся при обновлении страницы, переходе
   * в другой раздел и возврате. Готовый файл после этого достать было нечем —
   * ручки «мои задачи» у API нет, только выдача по идентификатору, — и человек
   * заказывал сборку заново, второй раз занимая воркер.
   *
   * Тот же класс, что потерянная переписка помощника: то, что живёт на
   * сервере, не должно существовать только в памяти вкладки.
   */
  job?: string;
  /**
   * Строка поиска раздела.
   *
   * В адресе, потому что поиск — это ссылка: калькулятор, не нашедший продукт,
   * отправляет в справочник с тем же запросом, и переспрашивать его у семьи,
   * стоящей у плиты, незачем.
   */
  q?: string;
  /**
   * Отбор справочника продуктов «сверялись с источником раньше этой даты»
   * (`YYYY-MM-DD`). Приходит со ссылки главной администратора «N позиций не
   * сверялись»: прежде она клала дату в строку поиска, и справочник искал
   * продукты по названию «2025-10-07».
   */
  verified?: string;
}

/**
 * Состояние экрана, которое живёт в адресе (правила П1 и П30 канона) и общее у
 * раздела кабинета и карты пациента.
 *
 * Общее потому, что экраны стоят под двумя адресами: меню и дневник семьи — в
 * разделе, те же экраны у врача — в карте. Параметр, объявленный только одним
 * маршрутом, на другом терялся бы молча, и F5 возвращал бы врача к «сегодня».
 *
 * Все значения проверяются здесь, а не на экране: адрес набирают руками и
 * присылают в переписке, и `?date=вчера` обязан превратиться в умолчание, а не
 * уронить экран или уйти на сервер.
 */
export interface ViewStateSearch {
  /** Выбранный день плана питания, `YYYY-MM-DD` */
  date?: string;
  /** Период дневника: `week`, `month` или `custom` (тогда — `from`/`to`) */
  period?: PeriodSearch;
  /** Начало периода (дневник, отчёт, журнал аудита), `YYYY-MM-DD` */
  from?: string;
  /** Конец периода, `YYYY-MM-DD`, включительно */
  to?: string;
}

export type PeriodSearch = "week" | "month" | "custom";

const PERIODS: readonly PeriodSearch[] = ["week", "month", "custom"];

/**
 * Отборы списков раздела кабинета: реестр пациентов, справочник продуктов,
 * база рецептов, журнал аудита. Строка поиска (`q`) объявлена выше — она
 * старше остальных и приходит со ссылок других экранов.
 */
export interface FilterSearch {
  /** Реестр пациентов: `active` (умолчание, в адресе не пишется) или `ended` */
  therapy?: "ended";
  /** Категория продукта (идентификатор) или рецепта (код) */
  category?: string;
  /** Справочник продуктов: ведущий макронутриент */
  macro?: "fat" | "protein" | "carbs";
  /** Справочник продуктов: показывать выведенные из оборота */
  inactive?: true;
  /** Границы кетосоотношения в отборе рецептов — строки как в поле ввода */
  ratioMin?: string;
  ratioMax?: string;
  /** Журнал аудита: автор действия (идентификатор учётной записи) */
  user?: string;
  /** Журнал аудита: таблица и действие */
  entity?: string;
  action?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATIO_BOUND = /^\d{1,2}(?:[.,]\d{1,2})?$/;

/** Календарная дата, которая существует: `2026-02-30` — не дата, а опечатка. */
function isoDate(value: unknown): string | undefined {
  const raw = text(value);
  if (raw === undefined || !ISO_DATE.test(raw)) return undefined;
  const [year, month, day] = raw.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
    ? raw
    : undefined;
}

function matching(value: unknown, pattern: RegExp): string | undefined {
  // Роутер разбирает значения как JSON: `?ratioMin=3.5` приходит числом.
  const raw = typeof value === "number" ? String(value) : text(value);
  return raw !== undefined && pattern.test(raw) ? raw : undefined;
}

export function validateViewState(
  search: Record<string, unknown>,
): ViewStateSearch {
  const period = PERIODS.find((value) => value === search.period);
  // Отвергнутое значение возвращается ключом со значением `undefined`, а не
  // пропуском ключа. Корневой маршрут параметров не проверяет, и TanStack
  // Router накладывает проверенное поверх сырого: пропущенный ключ оставил бы
  // в `useSearch({ strict: false })` исходные `?date=2026-02-30`, и экран
  // получил бы то, что проверка только что отвергла. В адрес `undefined` не
  // пишется.
  return {
    date: isoDate(search.date),
    period,
    from: isoDate(search.from),
    to: isoDate(search.to),
  };
}

function validateFilters(search: Record<string, unknown>): FilterSearch {
  // Ключи с `undefined` — по той же причине, что в `validateViewState`.
  return {
    therapy: search.therapy === "ended" ? ("ended" as const) : undefined,
    category: matching(search.category, /^[\w-]{1,64}$/),
    macro: (["fat", "protein", "carbs"] as const).find(
      (value) => value === search.macro,
    ),
    // `?inactive=true` роутер разбирает как JSON — приходит булевым.
    inactive:
      search.inactive === true || search.inactive === "true"
        ? (true as const)
        : undefined,
    ratioMin: matching(search.ratioMin, RATIO_BOUND),
    ratioMax: matching(search.ratioMax, RATIO_BOUND),
    user: matching(search.user, UUID),
    entity: matching(search.entity, /^[a-z_]{1,64}$/),
    action: matching(search.action, /^[a-z_.]{1,64}$/),
  };
}

/** Непустая строка или ничего: `?tab=` в адресе — то же самое, что его отсутствие. */
export function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function validateSectionSearch(
  search: Record<string, unknown>,
): SectionSearch {
  const result: SectionSearch = {
    ...validateViewState(search),
    ...validateFilters(search),
  };
  const patient = text(search.patient);
  const tab = text(search.tab);
  const kind = text(search.kind);
  const item = text(search.item);
  const q = text(search.q);
  const job = text(search.job);
  const verified = text(search.verified);
  if (patient !== undefined) result.patient = patient;
  if (tab !== undefined) result.tab = tab;
  if (kind !== undefined) result.kind = kind;
  if (item !== undefined) result.item = item;
  if (q !== undefined) result.q = q;
  if (job !== undefined) result.job = job;
  if (verified !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(verified)) {
    result.verified = verified;
  }
  return result;
}

/**
 * Параметры адреса внутри карты пациента.
 *
 * Их два, и оба уже были у раздела: вид дневника и задача сборки отчёта.
 * Вкладки (`?tab=`) здесь нет — её место занял уровень пути, а `?patient=`
 * незачем: пациент и есть путь.
 */
export interface PatientSearch extends ViewStateSearch {
  /** Вид дневника внутри раздела «Дневники» */
  kind?: string;
  /**
   * Предмет, открытый внутри раздела: продукт или готовое блюдо, пришедшее в
   * калькулятор (`item=dish:<id>`). Тем же параметром состав, собранный в общем
   * калькуляторе, попадает в карту пациента.
   */
  item?: string;
  /**
   * Задача сборки PDF-отчёта. В адресе по той же причине, что и в разделах:
   * сборка идёт в воркере секундами, а ручки «мои задачи» у API нет — потеряв
   * идентификатор, готовый файл достать нечем.
   */
  job?: string;
}

export function validatePatientSearch(
  search: Record<string, unknown>,
): PatientSearch {
  const result: PatientSearch = validateViewState(search);
  const kind = text(search.kind);
  const item = text(search.item);
  const job = text(search.job);
  if (kind !== undefined) result.kind = kind;
  if (item !== undefined) result.item = item;
  if (job !== undefined) result.job = job;
  return result;
}
