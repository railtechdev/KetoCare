import { expect, test, type Browser, type Page } from "@playwright/test";

import { clearMenu, daysAgo, ensureDish, report, today } from "../src/api";
import { loginAsDoctor, loginAsParent, patientId } from "../src/auth";
import { flushRateLimits } from "../src/redis";

/**
 * Сквозной сценарий раздела 13 ТЗ: врач создаёт назначение → родитель собирает
 * меню → вносит дневники → отчёт формируется.
 *
 * Один тест, а не четыре: это одна цепочка, и разорванная посередине она
 * перестаёт что-либо доказывать. Смысл сценария в том, что назначение врача
 * доезжает до экрана родителя, а запись родителя — до отчёта врача; каждая из
 * четырёх частей по отдельности уже покрыта модульными тестами.
 *
 * **Два контекста, а не переключение в одном.** Врач и родитель — разные люди с
 * разными сессиями, и повторный вход в одном контексте упирался бы в настоящее
 * ограничение раздела 11 ТЗ (пять запросов к `/auth/*` в минуту на адрес): за
 * прогон получалось шесть обращений, и тест падал на защите, а не на дефекте.
 *
 * Числа сверяются с «было», снятым перед прогоном: база живёт дольше теста, и
 * ожидание «измерений: 1» превратило бы второй запуск в красный.
 */
test.beforeAll(flushRateLimits);

test("врач назначает, семья ведёт день, отчёт сходится", async ({
  browser,
}) => {
  const DISH = "Завтрак прогонный";
  const KETONE = "2.7";
  const WEIGHT = "15.4";

  const parent = await signedIn(browser, loginAsParent);
  const doctor = await signedIn(browser, loginAsDoctor);

  // --- предусловия ---------------------------------------------------------
  const patient = await patientId(parent.request);
  await ensureDish(parent.request, patient, DISH);
  await clearMenu(parent.request, patient, today());
  const before = await report(doctor.request, patient, daysAgo(29), today());

  // --- 1. врач создаёт назначение -----------------------------------------
  await doctor.goto(`/app/patients?patient=${patient}&tab=prescription`);

  await doctor.getByLabel("Кетосоотношение").fill("3.5");
  await doctor.getByLabel("Калорийность").fill("1200");
  await doctor.getByLabel("Белок").fill("22");
  await doctor.getByLabel("Углеводы не более").fill("10");
  await doctor.getByLabel("Приёмов пищи в день").fill("4");
  await doctor.getByRole("button", { name: "Сохранить назначение" }).click();

  // История версий — признак устойчивее тоста: тост живёт секунды и появляется
  // не по ответу сервера, а после перезагрузки истории.
  const history = doctor.getByRole("table", {
    name: "История версий назначения",
  });
  await expect(
    // Соотношение печатается значком «3.5 : 1» — с точкой, в отличие от чисел
    // отчёта: их форматирует Intl, и там разделитель запятая.
    history.getByRole("row").filter({ hasText: "3.5 : 1" }).first(),
  ).toBeVisible();

  // --- 2. родитель собирает меню на день -----------------------------------
  await parent.goto("/app/menu");
  await parent
    .getByRole("button", { name: "Добавить блюдо в приём «Завтрак»" })
    .click();
  // Выбор — с клавиатуры, а не мышью: список закрывается по `blur`, и щелчок по
  // варианту гонится с закрытием. Стрелка и Enter — тот же путь, которым
  // пользуется человек с клавиатурой, и он же устойчив.
  const picker = parent.getByRole("combobox", { name: "Блюдо" });
  await picker.fill(DISH);
  await expect(
    parent.getByRole("option", { name: new RegExp(DISH) }),
  ).toBeVisible();
  await picker.press("ArrowDown");
  await picker.press("Enter");
  await parent.getByRole("button", { name: "Добавить", exact: true }).click();

  const eaten = parent.getByRole("checkbox", {
    name: `Отметить «${DISH}» съеденным`,
  });
  await expect(eaten).toBeVisible();

  // Назначение врача доехало до экрана семьи. Строка появляется только когда в
  // дне есть блюдо и есть активное назначение, а число в ней — из шага 1: это и
  // есть стык, ради которого сценарий сквозной.
  await expect(parent.getByText(/Назначено приёмов в день: 4/)).toBeVisible();

  // `click`, а не `check`: отметка идёт оптимистично и подтверждается ответом
  // сервера, а `check` считает состояние сразу после нажатия и в этот момент
  // видит ещё старое.
  await eaten.click();
  await expect(eaten).toBeChecked();

  // --- 3. родитель вносит дневники ----------------------------------------
  await parent.goto("/app/diary?kind=ketones");
  await parent.getByRole("button", { name: "Добавить запись" }).first().click();
  await parent.locator("#ketone-value").fill(KETONE);
  await parent.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(
    // Карточка дневника печатает значение как есть, точкой. Запятая появляется
    // только в отчёте — там числа проходят через Intl.
    // `.first()`: прогонов было много, и записей с тем же значением в списке
    // несколько — это нормально, база живёт дольше теста.
    parent.getByRole("heading", { name: `${KETONE} ммоль/л` }).first(),
  ).toBeVisible();

  await parent.goto("/app/diary?kind=weight");
  await parent.getByRole("button", { name: "Добавить запись" }).first().click();
  await parent.locator("#weight-value").fill(WEIGHT);
  await parent.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(
    parent.getByRole("heading", { name: `${WEIGHT} кг` }).first(),
  ).toBeVisible();

  // --- 4. врач открывает отчёт --------------------------------------------
  await doctor.goto(`/app/patients?patient=${patient}&tab=reports`);

  // Период по умолчанию — последние тридцать дней: всё созданное сегодня в него
  // попадает, трогать поля незачем.
  await expect(
    doctor.getByText(
      `Дней спланировано: ${before.menu.days_planned + 1}, ` +
        `позиций в меню: ${before.menu.items_planned + 1}, ` +
        `отмечено съеденными: ${before.menu.items_eaten + 1}`,
    ),
  ).toBeVisible();

  await expect(
    doctor.getByText(
      new RegExp(`ммоль/л.*измерений: ${before.ketones.points.length + 1}`),
    ),
  ).toBeVisible();
  await expect(
    doctor.getByText(
      new RegExp(`кг.*измерений: ${before.weight.points.length + 1}`),
    ),
  ).toBeVisible();
});

/** Своя вкладка со своей сессией: у врача и родителя они разные. */
async function signedIn(
  browser: Browser,
  login: (page: Page) => Promise<void>,
): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);
  return page;
}
