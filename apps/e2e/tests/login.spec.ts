import { expect, test } from "@playwright/test";

import { PARENT_EMAIL, PASSWORD } from "../src/env";
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
