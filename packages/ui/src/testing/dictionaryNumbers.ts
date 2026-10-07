/** Сторож правила П45 для приложений: число рядом с единицей измерения.
 *
 * Не компонент и не помощник — проверка, которую зовут тесты кабинета и Mini
 * App. Живёт в ките по той же причине, по которой там живёт `lib/format`:
 * правило одно, и две его реализации разошлись бы молча. Кит — единственный
 * общий код у двух приложений.
 *
 * **Что ловится.** Текст на экранах приложений идёт через словари, и единица
 * измерения стоит в самом шаблоне: `"{{value}} ммоль/л"`. Значит место, где
 * число становится текстом, — вызов `t("ключ", { value: … })`, и правило
 * проверяемо: выражение, подставленное под переменную рядом с единицей
 * измерения, обязано пройти через помощник `format…`.
 *
 * **Чего не ловится** — и это осознанно, иначе проверка начала бы врать:
 * — значение, переданное соседним пропсом (`<Metric value={x} unit={t(…)} />`):
 *   в шаблоне его нет, связь видна только человеку;
 * — ключ, собранный выражением (`t(\`charts.${kind}.unit\`)`);
 * — переменные шаблона, не стоящие рядом с единицей (`{{min}}` в «от {{min}} до
 *   {{max}} кг»): их класс тот же, но «рядом» — единственный признак, по
 *   которому из текста видно, что это измерение, а не количество или имя.
 *
 * `toFixed` и своё `Intl.NumberFormat` ловят отдельные проверки в каждом
 * приложении. Этой не хватало: `t("ketones.cardTitle", { value: entry.value })`
 * не содержит ни того, ни другого — и «2.7 ммоль/л» печаталось рядом с
 * «18,16 кг» про одного ребёнка.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Единицы измерения, встречающиеся в словарях и в разметке кита. */
export const UNITS = ["ммоль/л", "ккал", "кг", "см", "мл", "мг", "г"];

/**
 * Единицы, которые по-русски совпадают со служебным словом.
 *
 * «с» — и секунды, и предлог: «Длительность: {{value}} с» и «Ещё {{count}} с
 * пометками». Поэтому такая единица считается единицей только в конце фразы или
 * перед знаком препинания — после предлога всегда идёт слово. В списке кита их
 * нет: там единицы приходят пропсом, а не словом.
 */
export const AMBIGUOUS_UNITS = ["с"];

/** Пометка «сырое число здесь намеренно» — в той же или одной из трёх строк выше. */
export const RAW_MARKER = "number:raw";

// `\b` здесь не годится: в JS границей слова считаются только ASCII-буквы, и
// после «см» или «кг» её нет вовсе — проверка молча не совпадала ни с чем.
// Поэтому конец единицы измерения описан отрицательным просмотром на букву.
const UNIT_AFTER = new RegExp(
  `\\{\\{(\\w+)[^}]*\\}\\}\\s?(?:` +
    `(?:${UNITS.join("|")})(?!\\p{L})` +
    `|(?:${AMBIGUOUS_UNITS.join("|")})(?=[.,;:!?)]|$)` +
    `)`,
  "gu",
);

export interface RawSubstitution {
  /** Файл с вызовом, путём от каталога исходников */
  file: string;
  /** Строка вызова */
  line: number;
  /** Ключ словаря */
  key: string;
  /** Шаблон как он записан в словаре */
  template: string;
  /** Переменная шаблона, стоящая перед единицей измерения */
  variable: string;
  /** Что подставляет вызов */
  expression: string;
}

/** Переменные шаблона, стоящие прямо перед единицей измерения. */
export function unitVariables(template: string): string[] {
  return [...template.matchAll(UNIT_AFTER)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** Плоский список «ключ → шаблон» из всех словарей каталога. */
function dictionary(localesDir: string): Map<string, string> {
  const result = new Map<string, string>();

  const walk = (node: unknown, path: string[]) => {
    if (typeof node === "string") {
      if (unitVariables(node).length > 0) result.set(path.join("."), node);
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        walk(value, [...path, key]);
      }
    }
  };

  for (const file of readdirSync(localesDir)) {
    if (!file.endsWith(".json")) continue;
    walk(JSON.parse(readFileSync(join(localesDir, file), "utf8")), []);
  }

  return result;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** Тело вызова от позиции после открывающей скобки до её пары. */
function callBody(source: string, start: number): string {
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    if (source[i] === "(") depth += 1;
    if (source[i] === ")") depth -= 1;
    i += 1;
  }
  return source.slice(start, i - 1);
}

/** Выражение, переданное под именем `name`, — до запятой того же уровня. */
export function argumentOf(body: string, name: string): string | null {
  const head = new RegExp(`\\b${name}\\s*:\\s*`).exec(body);
  if (!head) return null;

  let depth = 0;
  let i = head.index + head[0].length;
  const out: string[] = [];
  while (i < body.length) {
    const char = body[i] ?? "";
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) {
      if (depth === 0) break;
      depth -= 1;
    } else if (char === "," && depth === 0) break;
    out.push(char);
    i += 1;
  }

  return out.join("").trim().replace(/\s+/g, " ");
}

/** Первый аргумент вызова — до запятой верхнего уровня. */
function firstArgument(body: string): string {
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i] ?? "";
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === "," && depth === 0) return body.slice(0, i);
  }
  return body;
}

/**
 * Ключи словаря, которые может спросить вызов: литерал целиком или обе ветви
 * условия. Ключ, собранный выражением (`` `charts.${kind}` ``), не виден —
 * см. «Чего не ловится». Пространство имён (`ns:ключ`) отбрасывается: в
 * словаре его нет.
 */
export function calledKeys(argument: string): string[] {
  const literal = /^\s*["'`]([\w.:]+)["'`]\s*$/.exec(argument);
  const keys =
    literal !== null
      ? [literal[1] ?? ""]
      : argument.includes("?")
        ? [...argument.matchAll(/["'`]([\w.:]+)["'`]/g)].map(
            (match) => match[1] ?? "",
          )
        : [];
  return keys
    .filter((key) => key !== "")
    .map((key) => key.slice(key.lastIndexOf(":") + 1));
}

/** Признак того, что число прошло через помощник кита. */
export function goesThroughHelper(expression: string): boolean {
  return /\bformat[A-Z]\w*\s*\(/.test(expression);
}

/** Все места, где рядом с единицей измерения печатается сырое число. */
export function rawNumbersNextToUnits(options: {
  localesDir: string;
  sourceDir: string;
}): RawSubstitution[] {
  const templates = dictionary(options.localesDir);
  const found: RawSubstitution[] = [];
  const seen = new Set<string>();

  for (const path of sourceFiles(options.sourceDir)) {
    const source = readFileSync(path, "utf8");
    const lines = source.split("\n");

    for (const call of source.matchAll(/\bt\(/g)) {
      const body = callBody(source, call.index + call[0].length);
      // Ключей бывает два: `t(delta > 0 ? "above" : "below", { value })` —
      // переменная одна на оба шаблона, и пропустить такой вызов значило
      // пропустить ровно то место, где число печаталось сырым («на 12 ккал»
      // рядом с «1 200 ккал»).
      const keys = calledKeys(firstArgument(body));
      if (keys.length === 0) continue;
      const line = source.slice(0, call.index).split("\n").length;
      const nearby = lines.slice(Math.max(0, line - 4), line).join("\n");
      if (nearby.includes(RAW_MARKER)) continue;

      for (const [key, template] of templates) {
        if (
          !keys.some((called) => called === key || called.endsWith(`.${key}`))
        )
          continue;

        for (const variable of unitVariables(template)) {
          const expression = argumentOf(body, variable);
          if (expression === null || goesThroughHelper(expression)) continue;

          const place = `${relative(options.sourceDir, path)}:${line}:${variable}`;
          // Один и тот же вызов встречается дважды, когда одинаковый путь есть
          // в двух словарях (`day.kcalBelowTarget` и `summary.day.…`). Место
          // одно — и в списке оно должно быть одно.
          if (seen.has(place)) continue;
          seen.add(place);

          found.push({
            file: relative(options.sourceDir, path),
            line,
            key,
            template,
            variable,
            expression,
          });
        }
      }
    }
  }

  return found;
}
