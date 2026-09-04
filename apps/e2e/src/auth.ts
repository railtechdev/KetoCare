import type { APIRequestContext, Page } from "@playwright/test";

import { DOCTOR_EMAIL, PARENT_EMAIL, PASSWORD } from "./env";
import { totp } from "./totp";

/**
 * Вход в кабинет через API, а не через форму.
 *
 * Сценарий проверяет работу врача и семьи, а не экран входа — у него свой тест.
 * Прогонять форму перед каждым шагом значило бы платить за неё временем и
 * хрупкостью в каждом сценарии.
 *
 * Работает это потому, что refresh-токен живёт в httpOnly cookie: запрос из
 * контекста страницы оставляет её в браузере, а кабинет при загрузке
 * восстанавливает сессию обновлением токена. То есть после этой функции
 * достаточно открыть адрес.
 */
export async function loginAsParent(page: Page): Promise<void> {
  const response = await page.request.post("/api/v1/auth/login", {
    data: { email: PARENT_EMAIL, password: PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(
      `Родитель не вошёл: ${response.status()} ${await response.text()}`,
    );
  }
}

/**
 * Врачу второй фактор обязателен (раздел 5.2 ТЗ), поэтому вход длиннее.
 *
 * Секрет не хранится в репозитории и не сеется: сид сбрасывает второй фактор
 * врача перед каждым прогоном, вход отвечает `totp_setup_required`, и тест
 * проходит настоящую первичную настройку — получает секрет-кандидат, считает по
 * нему код и подтверждает. Заодно это проверка сценария, который иначе не
 * проверяет никто: первый вход приглашённого специалиста.
 */
export async function loginAsDoctor(page: Page): Promise<void> {
  const first = await page.request.post("/api/v1/auth/login", {
    data: { email: DOCTOR_EMAIL, password: PASSWORD },
  });
  if (!first.ok()) {
    throw new Error(`Врач не вошёл: ${first.status()} ${await first.text()}`);
  }

  const body = await first.json();
  if (body.status === "ok") return;
  if (body.status !== "totp_setup_required") {
    throw new Error(`Неожиданный ответ входа: ${JSON.stringify(body)}`);
  }

  const setup = await page.request.post("/api/v1/auth/totp/setup", {
    headers: { Authorization: `Bearer ${body.totp_setup_token}` },
    data: {},
  });
  const { secret } = await setup.json();

  const verify = await page.request.post("/api/v1/auth/totp/verify", {
    headers: { Authorization: `Bearer ${body.totp_setup_token}` },
    data: { code: totp(secret) },
  });
  if (!verify.ok()) {
    throw new Error(`Второй фактор не включился: ${await verify.text()}`);
  }
}

/** Идентификатор ребёнка, доступного вошедшему пользователю. */
export async function patientId(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/v1/patients?limit=1&offset=0");
  const body = await response.json();
  const patient = body.items?.[0];
  if (!patient)
    throw new Error(
      "У учётной записи нет доступных пациентов — сид не отработал?",
    );
  return patient.id as string;
}
