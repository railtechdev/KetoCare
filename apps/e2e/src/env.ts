import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Корень репозитория: `.env` объявляет порты один раз для всех. */
export const ROOT = resolve(HERE, "../../..");

/**
 * Значения из корневого `.env`.
 *
 * Читается вручную, без зависимости: dotenv здесь понадобился бы ради двадцати
 * строк разбора, а правило «не добавлять зависимости на всякий случай» —
 * раздел 16 ТЗ. Формат простой: `КЛЮЧ=значение`, комментарии с `#`.
 */
function dotenv(): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(resolve(ROOT, ".env"), "utf8");
  } catch {
    return {};
  }

  const values: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    // Хвостовой комментарий срезается, как это делает shell в `. ./.env`:
    // иначе `SECRET=ABC # заметка` дал бы тестам «ABC # заметка», а сиду —
    // «ABC», и значения разошлись бы там, где человек этого не ждёт.
    values[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .split(" #")[0]!
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return values;
}

const FILE = dotenv();

function value(name: string, fallback: string): string {
  return process.env[name] ?? FILE[name] ?? fallback;
}

/**
 * Порт API берётся из `API_PROXY_TARGET` — того же адреса, куда дев-сервер
 * кабинета проксирует `/api`. Отдельной переменной у него нет намеренно: два
 * объявления одного порта рано или поздно разъедутся (см. Makefile).
 */
function apiPort(): string {
  const match = /:(\d+)/.exec(value("API_PROXY_TARGET", ""));
  return match ? match[1]! : "8001";
}

/**
 * Redis, в котором API держит счётчики ограничителя частоты.
 *
 * Тот же самый, что у приложения, а не свой: API может быть уже поднят
 * (`reuseExistingServer`), и тогда он читает адрес из корневого `.env`, а не из
 * окружения, которое передаст Playwright. Стирать счётчики нужно там, где их
 * ведут, — иначе очистка молча промахивается.
 */
const REDIS = new URL(value("REDIS_URL", "redis://127.0.0.1:6379/0"));
export const REDIS_HOST = REDIS.hostname;
export const REDIS_PORT = REDIS.port || "6379";
export const REDIS_DB = REDIS.pathname.replace("/", "") || "0";

export const WEB_PORT = value("WEB_PORT", "5173");
export const MINIAPP_PORT = value("MINIAPP_PORT", "5174");
export const API_PORT = apiPort();
// `localhost`, а не `127.0.0.1`: vite слушает имя, которое на этой машине
// разрешается сначала в ::1, и проверка готовности по адресу IPv4 не отвечает
// вовсе — Playwright решает, что сервер не поднялся, и ждёт две минуты впустую.
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const MINIAPP_URL = `http://localhost:${MINIAPP_PORT}`;
export const API_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * Токен бота — им подписывается строка запуска Mini App.
 *
 * Значение фиктивное и годится только для прогона: подпись считает тест, а
 * проверяет сервер, и обоим нужен ОДИН и тот же токен. Настоящий токен здесь не
 * нужен вовсе — Telegram в прогоне не участвует.
 */
export const BOT_TOKEN = value(
  "BOT_TOKEN",
  "e2e:bot-token-not-used-outside-tests",
);

/** Сервисный токен бота: им бот гасит код доступа (ADR-0009, два ключа). */
export const BOT_API_TOKEN = value("BOT_API_TOKEN", "dev-bot-service-token");

/**
 * Учётные записи стенда. Пароль по умолчанию годится только для локальной базы:
 * на публичном стенде его перекрывает переменная окружения — тот же довод, что
 * у `seed_demo.py`.
 */
export const PASSWORD = value(
  "E2E_PASSWORD",
  "e2e correct horse battery staple",
);
export const DOCTOR_EMAIL = "e2e-doctor@example.com";
export const PARENT_EMAIL = "e2e-parent@example.com";

/**
 * Второй фактор врача прогона — заданный, а не настроенный на ходу.
 *
 * Секрет один и тот же у сида и у прогона, поэтому состояние живёт ТОЛЬКО в
 * базе. Прежде тест настраивал второй фактор сам и запоминал секрет в файле:
 * состояние оказывалось в двух местах, и рассинхрон давал «врач не вошёл по
 * коду» без объяснимой причины.
 *
 * Значение фиктивное и годится только для локальной базы — тот же довод, что у
 * пароля выше. Формат — base32 (`A-Z2-7`), как у `pyotp.random_base32()`.
 */
export const DOCTOR_TOTP_SECRET = value(
  "E2E_TOTP_SECRET",
  "KETOCAREE2ETOTPSECRET234567ABCDE",
);

/**
 * Врач, которому второй фактор ещё предстоит настроить.
 *
 * Отдельная учётка, потому что первичная настройка — одноразовое событие: у
 * основного врача она случилась бы один раз, а дальше проверяла бы уже другой
 * путь. Здесь она проверяется осознанно, тестом в `login.spec.ts`.
 */
export const DOCTOR_SETUP_EMAIL = "e2e-doctor-setup@example.com";
