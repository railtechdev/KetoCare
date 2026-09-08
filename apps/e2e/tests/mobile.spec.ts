import { expect, test } from "@playwright/test";

import { ensureKetoneReading } from "../src/api";
import { loginAsParent, patientId } from "../src/auth";
import { flushRateLimits } from "../src/redis";

/**
 * Экраны семьи на настоящем телефоне: 360 x 740.
 *
 * Почему отдельный прогон, а не проверка в браузере руками: окно Chrome не
 * сжимается уже 500 px, и всё, что проверялось «на глаз», проверялось на 500+.
 * Брейкпоинты при этом работали правильно (500 < `sm`), а вот запаса по МЕСТУ
 * не проверял никто.
 *
 * Сегодня проверка зелёная, и это не повод её убрать: она сторожит целый класс
 * — длинное слово без переносов, фиксированная ширина, широкая таблица вне
 * своего прокручиваемого блока. Любое из этого уводит страницу вбок, и заметить
 * это без настоящих 360 px нельзя.
 *
 * Горизонтальная прокрутка на телефоне — не косметика: родитель ведёт дневник
 * одной рукой, и уехавшая вбок страница означает, что часть кнопок он просто не
 * видит. Раздел 8.2 ТЗ называет мобильный веб основным сценарием семьи.
 *
 * Прокручиваемые контейнеры (широкая таблица внутри своего блока — правило П17
 * канона) исключены намеренно: они прокручиваются сами и страницу вбок не тянут.
 */
test.use({ viewport: { width: 360, height: 740 } });

test.beforeAll(flushRateLimits);

const SECTIONS = [
  "home",
  "menu",
  "diary",
  "calculator",
  "recipes",
  "products",
  "reports",
] as const;

test("экраны семьи помещаются в 360 px", async ({ page }) => {
  await loginAsParent(page);
  const patient = await patientId(page.request);
  // Без записей дневник не рисует график, а именно он и уезжал вбок. Проверка
  // на пустом экране прошла бы всегда и ничего не значила.
  await ensureKetoneReading(page.request, patient);

  for (const section of SECTIONS) {
    await page.goto(`/app/${section}?patient=${patient}`);
    // Ждём содержимое, а не только каркас: скелетон уже, чем данные, и на нём
    // не переполняется ничего.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");

    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      const offenders: string[] = [];

      const all = Array.from(
        document.querySelectorAll("main *"),
      ) as HTMLElement[];

      for (const element of all) {
        const style = getComputedStyle(element);
        if (/auto|scroll/.test(style.overflowX)) continue;
        // Визуально скрытые подписи (`sr-only` — коробка 1 x 1 px с обрезкой)
        // всегда «переполнены» своим текстом. Это не прокрутка страницы, а
        // способ спрятать текст от глаза, оставив его скринридеру.
        if (element.clientWidth < 8) continue;
        if (element.scrollWidth > element.clientWidth + 1) {
          offenders.push(
            `${element.tagName}.${element.className.toString().slice(0, 40)} ` +
              `+${element.scrollWidth - element.clientWidth}px`,
          );
        }
      }

      return {
        page: root.scrollWidth - root.clientWidth,
        offenders: offenders.slice(0, 5),
      };
    });

    expect(overflow.offenders, `раздел ${section}`).toEqual([]);
    expect(
      overflow.page,
      `раздел ${section}: страница уезжает вбок`,
    ).toBeLessThanOrEqual(1);
  }
});
