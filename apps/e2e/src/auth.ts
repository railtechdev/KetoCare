import type { APIRequestContext, Page } from "@playwright/test";

import {
  DOCTOR_EMAIL,
  DOCTOR_TOTP_SECRET,
  PARENT_EMAIL,
  PASSWORD,
} from "./env";
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
 * Секрет задаёт сид — тот же, что читает прогон (`E2E_TOTP_SECRET`), — и вход
 * сразу шлёт код. Никакого состояния вне базы: прежде тест сам проходил
 * первичную настройку и запоминал секрет в файле, а сид его обнулял, и
 * синхронизировало эти два места только совпадение по времени. Расхождение
 * давало «врач не вошёл по коду» без объяснимой причины; заодно секрет
 * приходилось хранить на диске и вычищать после прогона.
 *
 * Первичная настройка при этом не перестала проверяться: у неё свой врач и
 * свой тест (`login.spec.ts`), где она и является предметом проверки, а не
 * побочным действием каждого входа.
 */
export async function loginAsDoctor(page: Page): Promise<void> {
  const response = await page.request.post("/api/v1/auth/login", {
    data: {
      email: DOCTOR_EMAIL,
      password: PASSWORD,
      totp_code: totp(DOCTOR_TOTP_SECRET),
    },
  });
  if (!response.ok()) {
    throw new Error(`Врач не вошёл: ${response.status()}`);
  }

  // Код ответа сессии не обещает: вход отвечает состояниями, и
  // `password_change_required` — тоже успешный ответ, но токенов не даёт.
  // Тело наружу не выводится: в нём токены.
  const body = await response.json();
  if (body.status !== "ok") {
    throw new Error(`Вход врача не дал сессию: ${String(body.status)}`);
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
