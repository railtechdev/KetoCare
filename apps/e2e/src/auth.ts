import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
 *
 * Настроенный секрет запоминается на время прогона. Сид отрабатывает ОДИН раз
 * перед всеми файлами, а входов за прогон много: повтор упавшего сценария,
 * второй файл тестов. Со второго входа сервер отвечает уже `totp_required` —
 * это не ошибка, а тот самый шаг входа, — и без запомненного секрета сценарий
 * не переживал собственный повтор: в ночном прогоне с 08.09 первая попытка
 * падала по делу, а повтор — «Неожиданный ответ входа», пряча настоящую
 * причину.
 */
const SECRET_FILE = join(tmpdir(), "ketocare-e2e-doctor-totp");

/**
 * Секрет живёт в файле, а не в памяти модуля: Playwright перезапускает воркер
 * после упавшего теста, и переменная процесса до повтора не доживает — первая
 * попытка этой правки именно на этом и споткнулась.
 *
 * Файл лежит во временном каталоге (в репозиторий не попадает), пишется с
 * правами 0600 и удаляется по окончании прогона (`global-teardown.ts`).
 *
 * В АРТЕФАКТЫ прогона секрет при этом попадает — и не из-за файла: трасса
 * (`trace: retain-on-failure`) содержит тело ответа `/auth/totp/setup`, а
 * отчёт выгружается артефактом на неделю. Учётка сидовая, база прогона
 * одноразовая, пароль и так лежит в `seed_e2e.py` — но писать «не попадает»
 * нельзя: так и заводятся правила, которые есть только в тексте.
 *
 * Состояние прогона из-за этого живёт в двух местах — в БД и в файле, — и
 * синхронизирует их только сид, обнуляющий `totp_secret` при каждом запуске.
 * Правильнее завести детерминированный секрет в сиде и читать его из
 * окружения; тогда состояния вне БД нет вовсе, а первичная настройка
 * проверяется отдельным тестом в `login.spec.ts`, а не побочным эффектом.
 */
export function doctorSecretFile(): string {
  return SECRET_FILE;
}

function rememberDoctorSecret(secret: string): void {
  writeFileSync(SECRET_FILE, secret, { encoding: "utf8", mode: 0o600 });
}

function recallDoctorSecret(): string | null {
  try {
    const stored = readFileSync(SECRET_FILE, "utf8").trim();
    return stored === "" ? null : stored;
  } catch {
    return null;
  }
}
export async function loginAsDoctor(page: Page): Promise<void> {
  const first = await page.request.post("/api/v1/auth/login", {
    data: { email: DOCTOR_EMAIL, password: PASSWORD },
  });
  if (!first.ok()) {
    throw new Error(`Врач не вошёл: ${first.status()} ${await first.text()}`);
  }

  const body = await first.json();
  if (body.status === "ok") return;

  if (body.status === "totp_required") {
    const secret = recallDoctorSecret();
    if (secret === null) {
      throw new Error(
        "Второй фактор врача уже настроен, а секрет прогону неизвестен: " +
          "сид не отработал перед прогоном (infra/scripts/seed_e2e.py)",
      );
    }
    const again = await page.request.post("/api/v1/auth/login", {
      data: {
        email: DOCTOR_EMAIL,
        password: PASSWORD,
        totp_code: totp(secret),
      },
    });
    if (!again.ok()) {
      throw new Error(`Врач не вошёл по коду: ${await again.text()}`);
    }
    // 200 сам по себе ничего не обещает: вход отвечает состояниями, и
    // `password_change_required` — тоже успешный ответ, но сессии не даёт.
    // Без этой проверки сценарий шёл бы дальше без токенов и падал позже, в
    // другом месте, обвиняя не то.
    const done = await again.json();
    if (done.status !== "ok") {
      throw new Error(`Вход по коду не дал сессию: ${JSON.stringify(done)}`);
    }
    return;
  }

  if (body.status !== "totp_setup_required") {
    throw new Error(`Неожиданный ответ входа: ${JSON.stringify(body)}`);
  }

  const setup = await page.request.post("/api/v1/auth/totp/setup", {
    headers: { Authorization: `Bearer ${body.totp_setup_token}` },
    data: {},
  });
  const { secret } = await setup.json();
  rememberDoctorSecret(secret);

  const verify = await page.request.post("/api/v1/auth/totp/verify", {
    headers: { Authorization: `Bearer ${body.totp_setup_token}` },
    data: { code: totp(secret) },
  });
  if (!verify.ok()) {
    throw new Error(`Второй фактор не включился: ${await verify.text()}`);
  }
  // Та же придирка, что и к повторному входу: код ответа сессии не обещает.
  // Сессия приходит именно отсюда — `/auth/totp/verify` ставит куки.
  const enabled = await verify.json();
  if (enabled.status !== "ok") {
    throw new Error(
      `Настройка второго фактора не дала сессию: ${JSON.stringify(enabled)}`,
    );
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
