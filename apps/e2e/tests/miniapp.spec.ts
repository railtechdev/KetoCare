import { expect, test } from "@playwright/test";

import { loginAsDoctor, loginAsParent, patientId } from "../src/auth";
import { clearMenu, ensureDish } from "../src/api";
import { flushRateLimits } from "../src/redis";
import { MINIAPP_URL } from "../src/env";
import {
  ensurePrescription,
  ensureTelegramLink,
  launchUrl,
  signedInitData,
} from "../src/miniapp";

/**
 * Mini App: семья из Telegram собирает день и отмечает съеденное (раздел 9 ТЗ).
 *
 * Почему этот прогон нужен отдельно от модульных тестов приложения: те работают
 * с подделкой API, а подделка повторяет представления автора о контракте, а не
 * сам контракт. Здесь проходит настоящая цепочка — код врача, погашение ботом,
 * подпись запуска, сессия, сужённая до ребёнка, запись плана и отметка.
 *
 * Телефонный размер, а не настольный: Mini App живёт во встроенном браузере
 * Telegram и другого размера не видит. 390 x 844 — iPhone 14, как в разборе
 * `docs/AUDIT_MINIAPP.md`.
 *
 * **День берётся ЗАВТРАШНИЙ.** Сегодняшний пишет `journey.spec.ts`, прогон идёт
 * по общей базе одним воркером, и два сценария на одной дате мешали бы друг
 * другу — падение читалось бы как ошибка приложения.
 */
test.use({ viewport: { width: 390, height: 844 } });

// `/auth/telegram-init` ограничен пятью обращениями в минуту, а один прогон
// тратит их законно: проверка привязки в предусловиях, запуск, перезагрузка.
// Без сброса тест падал на «Не удалось открыть кабинет» — то есть на 429,
// который на экране выглядит как сбой сессии.
test.beforeEach(flushRateLimits);

/** Блюдо для сборки: своё блюдо ребёнка, как его завела бы семья. */
const DISH = "Блюдо Mini App E2E";

function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tashkent" });
}

test("семья из Telegram собирает завтрашний день и отмечает съеденное", async ({
  page,
}) => {
  // Пациент берётся у РОДИТЕЛЯ, как в сквозном сценарии: у него ровно один
  // ребёнок. У врача их несколько — сценарий онбординга заводит нового при
  // каждом прогоне, — и `limit=1` вернул бы произвольного, к которому семья
  // доступа не имеет. Так и вышло: блюдо не создалось с отказом 403.
  const parentPage = await page.context().newPage();
  await loginAsParent(parentPage);
  const patient = await patientId(parentPage.request);
  // Блюдо заводит семья, а не врач: своих блюд у врача нет (ADR-0027), и сид
  // их не сеет — их создаёт тот, кто готовит.
  await ensureDish(parentPage.request, patient, DISH);
  await parentPage.close();

  const doctorPage = await page.context().newPage();
  await loginAsDoctor(doctorPage);
  const doctor = doctorPage.request;
  const targets = await ensurePrescription(doctor, patient);
  await ensureTelegramLink(doctor, patient);
  // Хвост прошлого прогона: план на завтра остался бы, и «Собрать день» легло
  // бы поверх — тест проверял бы историю запусков, а не результат.
  await clearMenu(doctor, patient, tomorrow());
  await doctorPage.close();

  // Предусловия израсходовали часть лимита на `telegram-init` — дальше идёт
  // сам сценарий, и ему нужны свои попытки.
  await flushRateLimits();

  // --- запуск приложения ----------------------------------------------------
  await page.goto(launchUrl(signedInitData()));

  // Сессия открылась по подписи: ни почты, ни пароля семья не заводила.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Меню" }).click();
  await page.getByRole("button", { name: "Завтра" }).click();

  // --- сборка дня -----------------------------------------------------------
  await page.getByRole("button", { name: "Собрать день" }).click();
  const search = page.getByLabel("Найти блюдо или рецепт");
  await expect(search).toBeVisible();

  const dish = page.getByRole("button", { name: new RegExp(DISH) });
  await expect(dish).toBeVisible();
  await dish.click();

  await page.getByLabel("Приём пищи").selectOption({ label: "Приём 2" });
  await page.getByRole("button", { name: "Добавить в день" }).click();

  // --- что семья видит после сборки ----------------------------------------
  await expect(page.getByRole("heading", { name: "Приём 2" })).toBeVisible();

  // Цели назначения рядом с итогами: собирать суточный рацион ребёнка, не видя
  // их, — собирать вслепую. Числа считает ядро на сервере, клиент их не шлёт.
  await expect(
    page.getByText(new RegExp(`из ${targets.kcalPerDay.toLocaleString("ru")}`)),
  ).toBeVisible();
  await expect(page.getByText(/осталось .* ккал/)).toBeVisible();

  // --- отметка «съедено» ----------------------------------------------------
  // `click`, а не `check`: у `check` своё короткое ожидание, а отметка живёт на
  // сервере — состояние меняется после обращения и обновления запроса, и
  // Playwright успевал объявить «нажатие не изменило состояние» раньше ответа.
  const eaten = page.getByRole("checkbox").first();
  await eaten.click();
  await expect(eaten).toBeChecked();

  // Отметка живёт на сервере, а не в памяти вкладки: если после перезагрузки
  // пропало — это дефект (правило из AUDIT_UX).
  await page.reload();
  await page.getByRole("button", { name: "Меню" }).click();
  await page.getByRole("button", { name: "Завтра" }).click();
  await expect(page.getByRole("checkbox").first()).toBeChecked();

  // Съеденное убрать нельзя — сначала снимается отметка: это уже не план, а
  // запись о том, что ребёнок ел (ADR-0041).
  await expect(page.getByRole("button", { name: "Убрать" })).toHaveCount(0);
});

test("без подписи приложение объясняет, как привязать чат, а не отказывает", async ({
  page,
}) => {
  // Открыто вне Telegram: подписи нет вовсе, и это не сбой, а состояние с
  // понятным продолжением — код выдаёт врач.
  await page.goto(MINIAPP_URL);

  await expect(page.getByText(/открывается из Telegram/)).toBeVisible();
});

test("подделанная подпись не пускает", async ({ page }) => {
  // Подпись — единственное, что отделяет семью от чужой карты ребёнка. Сервер
  // обязан её проверять, и проверка не должна зависеть от клиента.
  const forged = signedInitData().replace(
    /hash=[0-9a-f]+/,
    "hash=" + "0".repeat(64),
  );

  await page.goto(`${MINIAPP_URL}/#tgWebAppData=${encodeURIComponent(forged)}`);

  await expect(page.getByText(/Не удалось открыть кабинет/)).toBeVisible();
});
