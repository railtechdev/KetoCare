import { expect, test } from "@playwright/test";

import { DOCTOR_SETUP_EMAIL, PARENT_EMAIL, PASSWORD } from "../src/env";
import { totp } from "../src/totp";
import { flushRateLimits } from "../src/redis";

/**
 * Вход через форму.
 *
 * Отдельно от сквозного сценария: там вход делается запросом, чтобы не платить
 * формой в каждом шаге, — и без этого теста экран входа не проверял бы никто,
 * кроме модульных тестов, которые не знают ни о cookie, ни о восстановлении
 * сессии при загрузке.
 */
// Счётчики ограничителя обнуляются перед файлом: пять запросов к `/auth/*` в
// минуту — настоящее ограничение раздела 11 ТЗ, и без обнуления файл падал бы на
// защите, работающей как задумано.
test.beforeAll(flushRateLimits);

test("родитель входит с формы и попадает на главную", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Электронная почта").fill(PARENT_EMAIL);
  await page.getByLabel("Пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();

  await expect(page).toHaveURL(/\/app\/home/);
});

test("неверный пароль не пускает и говорит об этом", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Электронная почта").fill(PARENT_EMAIL);
  await page.getByLabel("Пароль").fill("это не пароль");
  await page.getByRole("button", { name: "Войти" }).click();

  await expect(page.getByText("Неверный email или пароль.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

/**
 * Сессия переживает перезагрузку.
 *
 * Access-токен живёт в памяти вкладки, refresh — в httpOnly cookie, и кабинет
 * восстанавливает сессию обновлением токена при загрузке. Сломай это — человек
 * будет выброшен на вход при каждом F5, а модульные тесты не заметят: они не
 * перезагружают страницу.
 */
test("после перезагрузки родитель остаётся в кабинете", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Электронная почта").fill(PARENT_EMAIL);
  await page.getByLabel("Пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/app\/home/);

  await page.reload();

  await expect(page).toHaveURL(/\/app\/home/);
});

/**
 * Первый вход приглашённого специалиста.
 *
 * Врачу второй фактор обязателен, но до первого входа настроить его негде:
 * сервер отвечает состоянием `totp_setup_required` и выдаёт токен, годный
 * только для настройки. Раньше этот путь проходил каждый вход врача в сквозном
 * сценарии — то есть проверялся побочно и ровно один раз за прогон, а секрет
 * приходилось хранить между попытками. Теперь у него своя учётка и свой тест.
 */
test("врач настраивает второй фактор при первом входе", async ({ page }) => {
  const first = await page.request.post("/api/v1/auth/login", {
    data: { email: DOCTOR_SETUP_EMAIL, password: PASSWORD },
  });
  expect(first.ok()).toBe(true);

  const body = await first.json();
  expect(body.status).toBe("totp_setup_required");
  expect(typeof body.totp_setup_token).toBe("string");

  const setup = await page.request.post("/api/v1/auth/totp/setup", {
    headers: { Authorization: `Bearer ${body.totp_setup_token}` },
    data: {},
  });
  expect(setup.ok()).toBe(true);
  const { secret } = await setup.json();

  const verify = await page.request.post("/api/v1/auth/totp/verify", {
    headers: { Authorization: `Bearer ${body.totp_setup_token}` },
    data: { code: totp(secret) },
  });
  expect(verify.ok()).toBe(true);

  // Ручка обещает пару токенов и резервные коды — их и проверяем, а не
  // выдуманный `status`: у этого ответа его нет.
  const enabled = await verify.json();
  expect(typeof enabled.tokens?.access_token).toBe("string");
  expect(Array.isArray(enabled.backup_codes)).toBe(true);

  // Со второго входа сервер просит код, а не настройку: фактор включён.
  const again = await page.request.post("/api/v1/auth/login", {
    data: { email: DOCTOR_SETUP_EMAIL, password: PASSWORD },
  });
  expect((await again.json()).status).toBe("totp_required");
});
