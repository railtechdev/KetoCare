/**
 * Внешние адреса и контакты сайта — в одном месте.
 *
 * Всё читается из переменных окружения на сборке, потому что при передаче
 * проекта клиенту меняется домен, почта и, возможно, бот. Значения по
 * умолчанию — временный домен пред-прода (docs/DEPLOY.md).
 *
 * ВНИМАНИЕ: почта и Telegram ниже пришли из макета. Перед публикацией
 * убедитесь, что это работающие адреса, — неотвечающий контакт на лендинге
 * хуже отсутствующего.
 */

const env = import.meta.env;

/** Кабинет: отдельный поддомен, поэтому ссылка абсолютная. */
export const APP_URL: string =
  env.PUBLIC_APP_URL ?? "https://app.ketocare.railtech.uz";

/** Страница входа в кабинет. */
export const LOGIN_URL = `${APP_URL}/login`;

/** Куда уходят заявки с форм. Относительный путь: nginx лендинга проксирует
 *  его в API, поэтому запрос остаётся same-origin и CORS не нужен. */
export const LEADS_ENDPOINT = "/api/v1/leads";

export const CONTACT_EMAIL: string =
  env.PUBLIC_CONTACT_EMAIL ?? "hello@ketocare.uz";

export const TELEGRAM_URL: string =
  env.PUBLIC_TELEGRAM_URL ?? "https://t.me/ketocare";

/** Год в подвале берётся на сборке, а не хардкодится. */
export const BUILD_YEAR = new Date().getFullYear();
