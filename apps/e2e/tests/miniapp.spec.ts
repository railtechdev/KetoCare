import { expect, test, type Page } from "@playwright/test";

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
 * **День берётся ВЧЕРАШНИЙ.** Сегодняшний пишет `journey.spec.ts`, прогон идёт
 * по общей базе одним воркером, и два сценария на одной дате мешали бы друг
 * другу — падение читалось бы как ошибка приложения. Завтрашний не годится:
 * съесть будущий день нельзя, и флажка «съедено» у него нет. Вчера — ровно
 * случай семьи, отмечающей съеденное задним числом.
 */
test.use({ viewport: { width: 390, height: 844 } });

// `/auth/telegram-init` ограничен пятью обращениями в минуту, а один прогон
// тратит их законно: проверка привязки в предусловиях, запуск, перезагрузка.
// Без сброса тест падал на «Не удалось открыть приложение» — то есть на 429,
// который на экране выглядит как сбой сессии.
test.beforeEach(flushRateLimits);

/** Блюдо для сборки: своё блюдо ребёнка, как его завела бы семья. */
const DISH = "Блюдо Mini App E2E";

function yesterday(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tashkent" });
}

test("семья из Telegram собирает вчерашний день и отмечает съеденное", async ({
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
  // Хвост прошлого прогона: план на вчера остался бы, и «Составить меню» легло
  // бы поверх — тест проверял бы историю запусков, а не результат. Чистит
  // семья: отметку «съедено» снимает только она, а день с отметкой сервер не
  // удаляет.
  await clearMenu(parentPage.request, patient, yesterday());
  await parentPage.close();

  const doctorPage = await page.context().newPage();
  await loginAsDoctor(doctorPage);
  const doctor = doctorPage.request;
  const targets = await ensurePrescription(doctor, patient);
  await ensureTelegramLink(doctor, patient);
  await doctorPage.close();

  // Предусловия израсходовали часть лимита на `telegram-init` — дальше идёт
  // сам сценарий, и ему нужны свои попытки.
  await flushRateLimits();

  // --- запуск приложения ----------------------------------------------------
  await page.goto(launchUrl(signedInitData()));

  // Сессия открылась по подписи: ни почты, ни пароля семья не заводила.
  // Первая вкладка — «Сегодня» (ADR-0075), меню дня открывается с неё.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await openYesterdayMenu(page);

  // --- сборка дня -----------------------------------------------------------
  // У каждого назначенного приёма своя кнопка, и приём приходит выбранным.
  await page.getByRole("button", { name: "Добавить блюдо в приём 2" }).click();
  const search = page.getByLabel("Найти блюдо или рецепт");
  await expect(search).toBeVisible();

  const dish = page.getByRole("button", { name: new RegExp(DISH) });
  await expect(dish).toBeVisible();
  await dish.click();

  await expect(page.getByLabel("Приём пищи")).toHaveValue("2");
  await page.getByRole("button", { name: "Добавить в меню" }).click();

  // Панель не закрывается после блюда: можно добавлять дальше, а «Готово»
  // возвращает к меню.
  await expect(page.getByText(/— в приёме 2/)).toBeVisible();
  await page.getByRole("button", { name: "Готово" }).click();

  // --- что семья видит после сборки ----------------------------------------
  await expect(page.getByRole("heading", { name: "Приём 2" })).toBeVisible();

  // Цели назначения рядом с итогами: собирать суточный рацион ребёнка, не видя
  // их, — собирать вслепую. Числа считает ядро на сервере, клиент их не шлёт.
  const todayTab = page.locator('[data-tab="today"]');
  await expect(
    todayTab
      .getByText(new RegExp(`из ${targets.kcalPerDay.toLocaleString("ru")}`))
      .first(),
  ).toBeVisible();
  await expect(
    todayTab.getByText(/Чтобы набрать суточную норму, добавьте ещё .* ккал/),
  ).toBeVisible();

  // --- отметка «съедено» ----------------------------------------------------
  // `click`, а не `check`: у `check` своё короткое ожидание, а отметка живёт на
  // сервере — состояние меняется после обращения и обновления запроса.
  const eaten = page.getByRole("checkbox").first();
  await eaten.click();
  await expect(eaten).toBeChecked();

  // Отметка живёт на сервере, а не в памяти вкладки: если после перезагрузки
  // пропало — это дефект (правило из AUDIT_UX).
  await page.reload();
  await openYesterdayMenu(page);
  await expect(page.getByRole("checkbox").first()).toBeChecked();

  // Съеденное убрать нельзя — сначала снимается отметка: это уже не меню, а
  // запись о том, что ребёнок ел (ADR-0041).
  await expect(page.getByRole("button", { name: "Убрать" })).toHaveCount(0);

  // На завтра флажка «съедено» нет: съесть будущий день нельзя.
  await page.getByRole("radio", { name: "Завтра" }).check();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

/**
 * «Сегодня» → меню дня → «Вчера».
 *
 * Кнопка на «Сегодня» называется по состоянию дня: «Открыть меню», если на
 * сегодня что-то стоит (его пишет `journey.spec.ts`), и «Составить меню», если
 * нет. Для этого сценария разницы нет — обе ведут в одно меню.
 */
async function openYesterdayMenu(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /^(Открыть меню|Составить меню)$/ })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Меню" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Вчера" }).check();
}

test("семья добавляет замер кетонов прямо в дневнике", async ({ page }) => {
  // До 07.10.2026 записи заводил только бот, а пустой дневник отправлял туда
  // же (дополнение к ADR-0044). Здесь проходит настоящая запись: форма кита,
  // ключ попытки, сессия Mini App и лента, перечитанная с сервера.
  const parentPage = await page.context().newPage();
  await loginAsParent(parentPage);
  const patient = await patientId(parentPage.request);
  await parentPage.close();

  const doctorPage = await page.context().newPage();
  await loginAsDoctor(doctorPage);
  await ensureTelegramLink(doctorPage.request, patient);
  await doctorPage.close();
  await flushRateLimits();

  await page.goto(launchUrl(signedInitData()));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Дневник" }).click();

  const diary = page.locator('[data-tab="diary"]');
  // Прошлые прогоны оставляют свои замеры в общей базе: сверяется прирост, а
  // не наличие.
  const entry = diary.getByText("Кетоны: 1,9 ммоль/л");
  // Лента загружена: либо пустое состояние, либо заголовок первого дня.
  await expect(
    diary
      .getByText("За две недели записей нет")
      .or(diary.getByRole("heading", { level: 3 }).first()),
  ).toBeVisible();
  const before = await entry.count();

  await diary.getByRole("button", { name: "Добавить запись" }).first().click();
  await page.getByRole("button", { name: "Кетоны", exact: true }).click();
  await page.getByLabel("Кетоны, ммоль/л").fill("1.9");
  await page.getByRole("button", { name: "Сохранить" }).click();

  await expect(page.getByText("Запись добавлена")).toBeVisible();
  await expect(entry).toHaveCount(before + 1);

  // Запись живёт на сервере, а не в памяти вкладки.
  await page.reload();
  await page.getByRole("button", { name: "Дневник" }).click();
  await expect(
    page.locator('[data-tab="diary"]').getByText("Кетоны: 1,9 ммоль/л"),
  ).toHaveCount(before + 1);
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

  // Сервер отвечает 401, и повтор с той же подписью не поможет: экран
  // отправляет открыть приложение заново из чата, а не «повторить».
  await expect(
    page.getByText("Закройте приложение и откройте снова из чата"),
  ).toBeVisible();
});

test("кнопка «Кетоны» на «Сегодня» открывает форму сразу, без выбора вида", async ({
  page,
}) => {
  // Быстрые записи (ADR-0075): прежде приступ стоил 7–9 нажатий, и курсор
  // вставал на дату, а не на значение.
  const parentPage = await page.context().newPage();
  await loginAsParent(parentPage);
  const patient = await patientId(parentPage.request);
  await parentPage.close();

  const doctorPage = await page.context().newPage();
  await loginAsDoctor(doctorPage);
  await ensureTelegramLink(doctorPage.request, patient);
  await doctorPage.close();
  await flushRateLimits();

  await page.goto(launchUrl(signedInitData()));
  await page
    .getByRole("button", { name: /^Кетоны/ })
    .first()
    .click();

  await expect(page.getByLabel("Кетоны, ммоль/л")).toBeFocused();
  await expect(page.getByText("Что записать?")).toHaveCount(0);
});

test("параметр запуска open=diary-weight открывает форму веса", async ({
  page,
}) => {
  // Договор с ботом (apps/miniapp/README.md): кнопка под напоминанием ведёт
  // сразу к форме, а не на главную.
  const parentPage = await page.context().newPage();
  await loginAsParent(parentPage);
  const patient = await patientId(parentPage.request);
  await parentPage.close();

  const doctorPage = await page.context().newPage();
  await loginAsDoctor(doctorPage);
  await ensureTelegramLink(doctorPage.request, patient);
  await doctorPage.close();
  await flushRateLimits();

  const url = launchUrl(signedInitData()).replace("/#", "/?open=diary-weight#");
  await page.goto(url);

  await expect(page.getByLabel("Вес, кг")).toBeVisible();
});
