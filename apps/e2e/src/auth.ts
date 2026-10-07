import type { APIRequestContext, APIResponse, Page } from "@playwright/test";

import {
  DOCTOR_EMAIL,
  DOCTOR_TOTP_SECRET,
  PARENT_EMAIL,
  PASSWORD,
} from "./env";
import { TOTP_STEP_SECONDS, totp } from "./totp";

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
  let response = await postDoctorLogin(page);
  // Страховка на случай, когда отметка шага в памяти потеряна (Playwright
  // перезапустил процесс после упавшего теста): сервер сам говорит, что шаг
  // занят, и ждать нужно ровно до следующего — не дольше 30 секунд.
  for (
    let attempt = 0;
    attempt < 2 && (await isReusedCode(response));
    attempt++
  ) {
    await waitForNextStep();
    response = await postDoctorLogin(page);
  }
  if (!response.ok()) {
    // Тело отказа безопасно: токенов в нём нет, а без него «401» не говорит
    // ничего. Подсказка про переменную — потому что первая же причина
    // расхождения кода с базой именно она.
    throw new Error(
      `Врач не вошёл: ${response.status()} ${await response.text()} ` +
        "(сверьте E2E_TOTP_SECRET: сид и прогон должны читать одно значение)",
    );
  }

  // Код ответа сессии не обещает: вход отвечает состояниями, и
  // `password_change_required` — тоже успешный ответ, но токенов не даёт.
  // Тело наружу не выводится: в нём токены.
  const body = await response.json();
  if (body.status !== "ok") {
    throw new Error(`Вход врача не дал сессию: ${String(body.status)}`);
  }
}

/**
 * Шаг TOTP, которым врач входил последним в этом процессе.
 *
 * Код одноразовый (RFC 6238 §5.2, находка Н8): сервер запоминает принятый шаг
 * и второй вход тем же кодом отвергает. Сценарии входят врачом по нескольку
 * раз за полминуты, поэтому перед входом ждём, пока шаг сменится. Процесс один
 * (`workers: 1` в playwright.config.ts), и отметки в памяти достаточно; на
 * случай перезапуска процесса есть повтор по `totp_reused` выше.
 */
let lastDoctorStep = -1;

function currentStep(): number {
  return Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
}

async function waitForNextStep(): Promise<void> {
  const next = (currentStep() + 1) * TOTP_STEP_SECONDS * 1000;
  // Полсекунды сверху — на расхождение часов прогона и сервера в одну сторону.
  await new Promise((resolve) => setTimeout(resolve, next - Date.now() + 500));
}

async function postDoctorLogin(page: Page): Promise<APIResponse> {
  if (currentStep() <= lastDoctorStep) await waitForNextStep();
  lastDoctorStep = currentStep();
  return page.request.post("/api/v1/auth/login", {
    data: {
      email: DOCTOR_EMAIL,
      password: PASSWORD,
      totp_code: totp(DOCTOR_TOTP_SECRET),
    },
  });
}

async function isReusedCode(response: APIResponse): Promise<boolean> {
  if (response.status() !== 401) return false;
  const body = await response.json().catch(() => null);
  return body?.error?.details?.reason === "totp_reused";
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
