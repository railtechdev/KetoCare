import { expect, test } from "@playwright/test";

import { loginAsDoctor } from "../src/auth";
import { flushRateLimits } from "../src/redis";

/**
 * Путь, которым семья попадает в систему (ADR-0040): врач заводит карту на
 * приёме и выдаёт код, семья активирует его дома.
 *
 * Отдельный сценарий, а не шаг основного: тот начинается с уже открытого
 * кабинета семьи и проверяет другое — что назначение доезжает до экрана
 * родителя, а запись родителя до отчёта. Здесь проверяется стык «врач → код →
 * учётная запись семьи», которого раньше не существовало вовсе: доступ выдавали
 * приглашением по почте.
 *
 * Почта нового родителя уникальна на прогон: база живёт дольше теста, и
 * повторный запуск с той же почтой упирался бы в «уже занята» — то есть в
 * настоящее правило, а не в дефект.
 */
test.beforeAll(flushRateLimits);

test("врач заводит карту и выдаёт код, семья входит по нему", async ({
  browser,
}) => {
  const suffix = Date.now().toString(36);
  const CHILD = `Прогонный Ребёнок ${suffix}`;
  const EMAIL = `family-${suffix}@example.com`;
  const PARENT_PASSWORD = "прогонный пароль семьи 42";

  const doctorContext = await browser.newContext();
  const doctor = await doctorContext.newPage();
  await loginAsDoctor(doctor);

  // --- 1. врач заводит карту на приёме ------------------------------------
  await doctor.goto("/app/patients");
  await doctor.getByRole("button", { name: "Новый пациент" }).click();
  await doctor.getByLabel("Имя и фамилия").fill(CHILD);
  await doctor.getByLabel("Дата рождения").fill("2019-04-12");
  await doctor.getByRole("button", { name: "Завести пациента" }).click();

  // Карта открывается сразу: врач завёл её, чтобы записать назначение.
  await expect(doctor).toHaveURL(/\/app\/patients\/[0-9a-f-]+\/profile/);

  // --- 2. врач выдаёт семье код -------------------------------------------
  await doctor.getByRole("button", { name: "Дать доступ семье" }).click();
  await doctor
    .getByRole("button", { name: /Дать доступ семье|Ещё один код/ })
    .last()
    .click();

  const code = (
    await doctor.locator("output").first().innerText()
  ).trim();
  expect(code).toHaveLength(8);

  // --- 3. семья активирует код в вебе -------------------------------------
  const familyContext = await browser.newContext();
  const family = await familyContext.newPage();
  await family.goto(`/join?code=${code}`);

  await expect(family.getByLabel("Код от врача")).toHaveValue(code);
  await family.getByLabel("Электронная почта").fill(EMAIL);
  await family.getByLabel("Имя и фамилия").fill("Родитель Прогонный");
  await family.getByLabel("Пароль", { exact: true }).fill(PARENT_PASSWORD);
  await family.getByLabel("Пароль ещё раз").fill(PARENT_PASSWORD);
  await family
    .getByRole("button", { name: "Создать учётную запись" })
    .click();

  await expect(
    family.getByRole("button", { name: "Перейти ко входу" }),
  ).toBeVisible();

  // --- 4. семья входит и видит того же ребёнка ----------------------------
  const login = await family.request.post("/api/v1/auth/login", {
    data: { email: EMAIL, password: PARENT_PASSWORD },
  });
  expect(login.ok()).toBeTruthy();

  await family.goto("/app/home");
  await expect(family.getByText(CHILD).first()).toBeVisible();

  await doctorContext.close();
  await familyContext.close();
});
