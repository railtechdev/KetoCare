import { expect, test, type Page } from "@playwright/test";

import { loginAsDoctor, loginAsParent, patientId } from "../src/auth";
import { ensurePrescription } from "../src/miniapp";
import { flushRateLimits } from "../src/redis";

/**
 * Рабочие экраны специалиста на ноутбуке: 1280 x 720.
 *
 * Правило П37 канона называет 1280 одной из четырёх обязательных ширин, но
 * проверка на ней существовала только в тексте. Отсюда и «каша на ноутбуке»
 * (замечание заказчика 12.11.2026): внутри карты пациента меню кабинета снова
 * стало широким, и меню кабинета, меню карты и приставная колонка оставляли
 * содержимому около 460 px — замер кетонов рвался посреди «ммоль/л», неделя
 * меню обрезалась на субботе, колонку «Источник» в справочнике продуктов
 * накрывала колонка действий. Тесты кабинета этого видеть не могут: в jsdom
 * нет раскладки.
 *
 * Строже телефонной проверки (`mobile.spec.ts`) в одном: прокрутка внутри
 * своего блока здесь тоже считается дефектом. На телефоне широкая таблица в
 * прокручиваемом блоке — правило П17, на ноутбуке врача она обязана
 * помещаться: спрятанная за краем колонка — та, которую врач не увидит.
 */
test.use({ viewport: { width: 1280, height: 720 } });

test.beforeEach(flushRateLimits);

// Разделы специалиста (`SECTIONS_BY_ROLE.doctor`) и разделы карты пациента
// (`features/doctor/patientViews.tsx`), кроме печатных форм.
const SECTIONS = ["patients", "recipes", "products", "calculator", "profile"];
const PATIENT_VIEWS = [
  "summary",
  "prescription",
  "dishes",
  "calculator",
  "menu",
  "diary",
  "growth",
  "course",
  "reports",
  "notes",
  "questions",
  "profile",
];

async function overflowOf(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const offenders: string[] = [];
    for (const element of Array.from(
      document.querySelectorAll("main *"),
    ) as HTMLElement[]) {
      // Скрытые подписи (`sr-only`) всегда «переполнены» своим текстом.
      if (element.clientWidth < 8 || element.offsetParent === null) continue;
      if (element.scrollWidth > element.clientWidth + 1) {
        const scrolls = /auto|scroll/.test(getComputedStyle(element).overflowX);
        offenders.push(
          `${scrolls ? "прокрутка в блоке" : "переполнение"} ` +
            `${element.tagName}.${element.className.toString().slice(0, 40)} ` +
            `+${element.scrollWidth - element.clientWidth}px ` +
            `«${(element.textContent ?? "").trim().slice(0, 40)}»`,
        );
      }
    }
    return {
      page: root.scrollWidth - root.clientWidth,
      offenders: offenders.slice(0, 5),
    };
  });
}

async function check(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const overflow = await overflowOf(page);
  // Мягкие: список всех сломанных экранов за один прогон, а не первый.
  expect.soft(overflow.offenders, path).toEqual([]);
  expect
    .soft(overflow.page, `${path}: страница уезжает вбок`)
    .toBeLessThanOrEqual(1);
}

test("экраны специалиста помещаются в 1280 px", async ({ page }) => {
  test.setTimeout(180_000);
  // Ребёнок с назначением: без него сводка и меню рисуют пустые состояния, а
  // на пустом экране не переполняется ничего.
  const parentPage = await page.context().newPage();
  await loginAsParent(parentPage);
  const patient = await patientId(parentPage.request);
  await parentPage.close();
  await loginAsDoctor(page);
  await ensurePrescription(page.request, patient);

  for (const section of SECTIONS) await check(page, `/app/${section}`);
  for (const view of PATIENT_VIEWS) {
    await check(page, `/app/patients/${patient}/${view}`);
  }
});
