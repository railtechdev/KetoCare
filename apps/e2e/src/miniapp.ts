import { createHmac } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";

import { API_URL, BOT_API_TOKEN, BOT_TOKEN, MINIAPP_URL } from "./env";

/**
 * Запуск Mini App в прогоне (раздел 9 ТЗ, [ADR-0017], [ADR-0040]).
 *
 * Mini App — главный канал семьи, пришедшей из Telegram: веб-кабинета у неё
 * нет вовсе. До этого файла он не проверялся сквозным прогоном ни разу — только
 * модульными тестами с подделкой API, а «подделка повторяет представления
 * автора о контракте, а не сам контракт» (CLAUDE.md). Три дефекта запуска в
 * истории проекта были видны ровно из живого клиента.
 *
 * **Привязка чата заводится настоящими ручками, а не записью в базу.** Врач
 * выдаёт код доступа, бот гасит его сервисным токеном — тот самый путь этапа Б,
 * которым приходит семья. Запись в обход ручек проверяла бы Mini App на
 * состоянии, которого продукт создать не умеет.
 *
 * Своей остаётся одна вещь — подпись строки запуска: её делает Telegram, и
 * заменить его в прогоне нечем. Алгоритм — из документации Telegram
 * (HMAC-SHA256 от токена с постоянной солью `WebAppData`), тот же, что у
 * `infra/scripts/miniapp_dev_link.py` и у тестов API. Сервер остаётся
 * единственным, кто подпись ПРОВЕРЯЕТ.
 */

/** Человек в Telegram: он же chat_id личной переписки. */
export const TELEGRAM_USER_ID = 777_000_777;

/** Второй чат того же человека — для проверки, что учётка остаётся одной. */
export const TELEGRAM_SECOND_CHAT_ID = 777_000_778;

/** Подписанная строка запуска — то, что Telegram передаёт приложению. */
export function signedInitData(
  userId: number = TELEGRAM_USER_ID,
  at: Date = new Date(),
): string {
  const fields: Record<string, string> = {
    user: JSON.stringify({
      id: userId,
      first_name: "Прогон",
      language_code: "ru",
    }),
    auth_date: String(Math.floor(at.getTime() / 1000)),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
  };

  // Проверочная строка — пары `ключ=значение` по возрастанию ключа, через
  // перевод строки, без самой подписи. Так её собирает и сервер.
  const check = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");

  return new URLSearchParams({ ...fields, hash }).toString();
}

/**
 * Адрес запуска.
 *
 * `tgWebAppData` в хеше — ровно там, где его читает приложение
 * (`lib/telegram.ts::fromAddress`). Значение кодируется целиком: внутри своя
 * строка запроса, и без кодирования её `&` разорвал бы параметры хеша.
 */
export function launchUrl(initData: string = signedInitData()): string {
  return `${MINIAPP_URL}/#tgWebAppData=${encodeURIComponent(initData)}`;
}

/**
 * Привязка чата к ребёнку, если её ещё нет.
 *
 * Идемпотентно, как `ensureDish`: прогон идёт по общей базе, и вторая привязка
 * того же чата отвечает 409 — «чат уже привязан». Проверяется не ответ
 * активации, а то, что сессия Mini App открывается: именно она нужна тесту.
 */
export async function ensureTelegramLink(
  doctor: APIRequestContext,
  patientId: string,
): Promise<void> {
  const initData = signedInitData();

  // Проверяется не «сессия открылась», а «сессия про ТОГО ребёнка».
  // Привязка живёт в базе между прогонами, и привязанная однажды к чужому
  // ребёнку она молча уводила бы весь сценарий на чужую карту: экран работал,
  // блюда не находились, и падение читалось как дефект приложения. Ровно так и
  // вышло, когда пациент брался у врача (у него их несколько).
  const scoped = await sessionPatient(initData);
  if (scoped === patientId) return;
  if (scoped !== null) await unlinkChat(doctor, scoped);

  const issued = await doctor.post(
    `/api/v1/patients/${patientId}/access-codes`,
  );
  if (!issued.ok()) {
    throw new Error(`Код доступа не выпустился: ${await issued.text()}`);
  }
  const { code } = (await issued.json()) as { code: string };

  const bot = await playwrightRequest.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { "X-Bot-Token": BOT_API_TOKEN },
  });
  try {
    const activated = await bot.post(
      "/api/v1/auth/access-codes/activate-telegram",
      {
        data: {
          code,
          chat_id: TELEGRAM_USER_ID,
          telegram_user_id: TELEGRAM_USER_ID,
          first_name: "Прогон",
        },
      },
    );
    // 409 — чат привязан прошлым прогоном; это и есть нужное состояние.
    if (!activated.ok() && activated.status() !== 409) {
      throw new Error(`Бот не активировал код: ${await activated.text()}`);
    }
  } finally {
    await bot.dispose();
  }

  const linked = await sessionPatient(initData);
  if (linked !== patientId) {
    throw new Error(
      `Привязка ведёт не к тому ребёнку: ожидался ${patientId}, получен ${linked}`,
    );
  }
}

/** Ребёнок, к которому сужена сессия Mini App; `null` — привязки нет. */
async function sessionPatient(initData: string): Promise<string | null> {
  const context = await playwrightRequest.newContext({ baseURL: API_URL });
  try {
    const response = await context.post("/api/v1/auth/telegram-init", {
      data: { init_data: initData },
    });
    if (!response.ok()) return null;
    return ((await response.json()) as { patient_id: string }).patient_id;
  } finally {
    await context.dispose();
  }
}

/**
 * Снимает привязку чата к чужому ребёнку.
 *
 * Отвязка — обычная ручка продукта, та же, которой пользуется врач при потере
 * телефона. Чистить базу напрямую здесь нельзя: прогон проверял бы состояние,
 * которого продукт создать не умеет.
 */
async function unlinkChat(
  doctor: APIRequestContext,
  patientId: string,
): Promise<void> {
  const links = await doctor.get(`/api/v1/patients/${patientId}/telegram`);
  if (!links.ok()) {
    throw new Error(
      `Чат привязан к ребёнку ${patientId}, а доступа к нему нет — ` +
        "снимите привязку вручную или заведите базу заново",
    );
  }
  const live = (
    (await links.json()) as { id: string; revoked_at: string | null }[]
  ).filter((link) => link.revoked_at === null);
  for (const link of live) {
    await doctor.post(
      `/api/v1/patients/${patientId}/telegram/${link.id}/revoke`,
    );
  }
}

/**
 * Назначение, без которого день не собрать: приёмы пищи и цели задаёт врач.
 *
 * Пишется только если активного нет: `prescriptions` — append-only (правило 4),
 * и назначение на каждый прогон копило бы строки в карте ребёнка.
 */
export async function ensurePrescription(
  doctor: APIRequestContext,
  patientId: string,
): Promise<{ kcalPerDay: number; carbsLimitG: number; mealsPerDay: number }> {
  const overview = await doctor.get(`/api/v1/patients/${patientId}/overview`);
  const current = (await overview.json()) as {
    prescription: {
      kcal_per_day: number;
      carbs_limit_g: number;
      meals_per_day: number;
    } | null;
  };

  if (current.prescription !== null) {
    return {
      kcalPerDay: current.prescription.kcal_per_day,
      carbsLimitG: current.prescription.carbs_limit_g,
      mealsPerDay: current.prescription.meals_per_day,
    };
  }

  const created = await doctor.post(
    `/api/v1/patients/${patientId}/prescriptions`,
    {
      data: {
        ratio: 3.5,
        kcal_per_day: 1200,
        protein_g: 25,
        carbs_limit_g: 12,
        meals_per_day: 4,
        effective_from: new Date().toLocaleDateString("sv-SE", {
          timeZone: "Asia/Tashkent",
        }),
      },
    },
  );
  if (!created.ok()) {
    throw new Error(`Назначение не записалось: ${await created.text()}`);
  }
  return { kcalPerDay: 1200, carbsLimitG: 12, mealsPerDay: 4 };
}
