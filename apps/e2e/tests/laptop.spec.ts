import { expect, test, type Page } from "@playwright/test";

import {
  loginAsAdmin,
  loginAsDietitian,
  loginAsDoctor,
  loginAsParent,
  patientId,
} from "../src/auth";
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
 * Две ширины. 1280 — ноутбук на весь экран, и здесь строже телефонной
 * проверки (`mobile.spec.ts`): прокрутка внутри своего блока тоже дефект,
 * спрятанная за краем колонка — та, которую врач не увидит. 1024 — окно
 * браузера не во весь экран (снимки заказчика 13.11.2026 были около 1000 px):
 * широкой таблице там разрешено прокручиваться в своём блоке (правило П17),
 * но страница вбок не уезжает и заголовки не сжимаются в столбик.
 */
const WIDTHS = [
  { width: 1280, height: 720, strict: true },
  { width: 1024, height: 640, strict: false },
] as const;

test.beforeEach(flushRateLimits);

// Разделы специалиста (`SECTIONS_BY_ROLE.doctor`, у диетолога те же) и
// разделы карты пациента (`features/doctor/patientViews.tsx`), кроме печатных
// форм.
const SECTIONS = ["patients", "recipes", "products", "calculator", "profile"];
// Вкладки справочника продуктов: «Подозрительные значения» видит только
// редактор справочника, то есть диетолог и администратор.
const PRODUCT_TABS = ["categories", "standards", "anomalies"];
const ADMIN_SECTIONS = [
  "home",
  "users",
  "leads",
  "products",
  "recipes",
  "dictionaries",
  "audit",
  "profile",
];
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
      // Текст записи журнала — окно кода с собственной прокруткой: JSON не
      // переносится по словам, и прокрутка там — способ его прочитать.
      if (element.tagName === "PRE" || element.closest("pre")) continue;
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
    // Заголовок блока, сжатый соседями в столбик. Переполнения тут нет —
    // текст честно переносится, — поэтому проверка выше его не видит: так
    // «Кто ведёт ребёнка дома» рядом с двумя кнопками стояло по слогу в строке
    // (снимок заказчика 13.11.2026).
    for (const heading of Array.from(
      document.querySelectorAll("main h2, main h3"),
    ) as HTMLElement[]) {
      if (heading.offsetParent === null || heading.closest(".sr-only"))
        continue;
      const box = heading.getBoundingClientRect();
      const line = parseFloat(getComputedStyle(heading).lineHeight) || 24;
      if (box.width > 0 && box.width < 192 && box.height > line * 2.5) {
        offenders.push(
          `сжатый заголовок ${Math.round(box.width)}px ` +
            `«${(heading.textContent ?? "").trim().slice(0, 40)}»`,
        );
      }
    }
    return {
      page: root.scrollWidth - root.clientWidth,
      offenders,
    };
  });
}

async function check(page: Page, path: string, strict: boolean): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const overflow = await overflowOf(page);
  if (!strict) {
    overflow.offenders = overflow.offenders.filter(
      (line) => !line.startsWith("прокрутка в блоке"),
    );
  }
  // Мягкие: список всех сломанных экранов за один прогон, а не первый.
  expect.soft(overflow.offenders, path).toEqual([]);
  expect
    .soft(overflow.page, `${path}: страница уезжает вбок`)
    .toBeLessThanOrEqual(1);
}

async function childOfParent(page: Page): Promise<string> {
  const parentPage = await page.context().newPage();
  await loginAsParent(parentPage);
  const patient = await patientId(parentPage.request);
  await parentPage.close();
  return patient;
}

for (const { width, height, strict } of WIDTHS) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height } });

    test(`экраны врача помещаются в ${width} px`, async ({ page }) => {
      test.setTimeout(180_000);
      // Ребёнок с назначением: без него сводка и меню рисуют пустые
      // состояния, а на пустом экране не переполняется ничего.
      const patient = await childOfParent(page);
      await loginAsDoctor(page);
      await ensurePrescription(page.request, patient);
      for (const section of SECTIONS) {
        await check(page, `/app/${section}`, strict);
      }
      for (const view of PATIENT_VIEWS) {
        await check(page, `/app/patients/${patient}/${view}`, strict);
      }
    });

    test(`экраны диетолога помещаются в ${width} px`, async ({ page }) => {
      test.setTimeout(180_000);
      const patient = await childOfParent(page);
      await loginAsDietitian(page);
      for (const tab of PRODUCT_TABS) {
        await check(page, `/app/products?tab=${tab}`, strict);
      }
      for (const view of ["summary", "prescription", "dishes", "menu"]) {
        await check(page, `/app/patients/${patient}/${view}`, strict);
      }
    });

    test(`экраны администратора помещаются в ${width} px`, async ({ page }) => {
      test.setTimeout(180_000);
      await loginAsAdmin(page);
      for (const section of ADMIN_SECTIONS) {
        await check(page, `/app/${section}`, strict);
      }
    });
  });
}
