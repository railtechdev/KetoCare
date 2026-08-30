/**
 * Сверяет константы демонстрационного калькулятора с расчётным ядром.
 *
 * Лендинг повторяет медицинские значения из `keto_engine`, а повторённое
 * значение однажды расходится с оригиналом молча — и тогда сайт публично
 * называет клинический допуск, которого в продукте уже нет. Проверка стоит
 * в `pnpm test`, то есть выполняется вместе со всеми тестами.
 *
 * Осознанно читает python-исходник текстом: тащить ради двух чисел мост
 * между Node и Python дороже, чем регулярное выражение с внятной ошибкой.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const enginePath = resolve(
  here,
  "../../keto_engine/src/keto_engine/constants.py",
);
const landingPath = resolve(here, "../src/lib/keto.ts");

const engine = readFileSync(enginePath, "utf8");
const landing = readFileSync(landingPath, "utf8");

const problems = [];

function compare(label, enginePattern, landingPattern) {
  const a = engine.match(enginePattern);
  const b = landing.match(landingPattern);
  if (!a) {
    problems.push(
      `${label}: не найдено в ${enginePath} — изменилось имя константы?`,
    );
    return;
  }
  if (!b) {
    problems.push(`${label}: не найдено в ${landingPath}`);
    return;
  }
  if (Number(a[1]) !== Number(b[1])) {
    problems.push(
      `${label}: в ядре ${a[1]}, на лендинге ${b[1]} — значения разошлись`,
    );
  }
}

compare(
  "допуск по кетосоотношению",
  /^RATIO_TOLERANCE\s*=\s*([\d.]+)/m,
  /^export const TOLERANCE = ([\d.]+);/m,
);

if (problems.length > 0) {
  console.error("Константы лендинга разошлись с расчётным ядром:");
  for (const p of problems) console.error("  • " + p);
  console.error("\nПравьте packages/landing/src/lib/keto.ts вслед за ядром.");
  process.exit(1);
}

console.log("константы лендинга совпадают с keto_engine");
