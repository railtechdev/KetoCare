import type { APIRequestContext } from "@playwright/test";

/**
 * Подготовка и чтение состояния через API.
 *
 * Через API делается ровно то, что в сценарии из раздела 13 ТЗ не проверяется:
 * предусловия и снятие «было». Всё, что сценарий обещает проверить — назначение,
 * меню, дневники, отчёт, — идёт через экраны, иначе тест доказывал бы работу
 * API, а не кабинета.
 */

/** Сегодняшний день в местной зоне — той же, в какой считает сервер. */
export function today(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tashkent" });
}

export function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tashkent" });
}

/** Продукт справочника по названию — им собирается блюдо для меню. */
export async function productByName(
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; name_ru: string }> {
  const response = await request.get(
    `/api/v1/products?q=${encodeURIComponent(name)}&limit=5&offset=0`,
  );
  const body = await response.json();
  const found = (body.items ?? []).find(
    (item: { name_ru: string }) => item.name_ru === name,
  );
  if (!found)
    throw new Error(`Нет продукта «${name}» — выполните make seed-e2e`);
  return found;
}

/**
 * Блюдо, которое можно положить в меню.
 *
 * Собирается запросом, а не через калькулятор: в сценарии ТЗ этого шага нет, а
 * прогон комбобокса с задержкой в 400 мс ради предусловия добавил бы хрупкости
 * там, где она ничего не проверяет. Сам калькулятор закрыт своими тестами.
 */
export async function ensureDish(
  request: APIRequestContext,
  patientId: string,
  title: string,
): Promise<string> {
  const existing = await request.get(
    `/api/v1/patients/${patientId}/custom-dishes?limit=50&offset=0`,
  );
  const found = (await existing.json()).items?.find(
    (dish: { title: string }) => dish.title === title,
  );
  if (found) return found.id as string;

  const butter = await productByName(request, "Масло сливочное E2E");
  const egg = await productByName(request, "Яйцо куриное E2E");

  const created = await request.post(
    `/api/v1/patients/${patientId}/custom-dishes`,
    {
      data: {
        title,
        ingredients: [
          { product_id: butter.id, grams: 30 },
          { product_id: egg.id, grams: 50 },
        ],
      },
    },
  );
  if (!created.ok())
    throw new Error(`Блюдо не создалось: ${await created.text()}`);
  return (await created.json()).id as string;
}

/**
 * Убрать план на день, если он остался от прошлого прогона.
 *
 * Без этого числа отчёта («позиций в меню») росли бы от прогона к прогону, и
 * сценарий проверял бы не результат, а историю запусков.
 */
export async function clearMenu(
  request: APIRequestContext,
  patientId: string,
  date: string,
): Promise<void> {
  await request.delete(`/api/v1/patients/${patientId}/menus?date=${date}`);
}

export interface Report {
  ketones: { points: unknown[] };
  weight: { points: unknown[] };
  menu: { days_planned: number; items_planned: number; items_eaten: number };
}

/** Отчёт за период — снимок «было», с которым сверяется «стало» на экране. */
export async function report(
  request: APIRequestContext,
  patientId: string,
  from: string,
  to: string,
): Promise<Report> {
  const response = await request.get(
    `/api/v1/patients/${patientId}/report?from=${from}&to=${to}&format=json`,
  );
  if (!response.ok())
    throw new Error(`Отчёт не пришёл: ${await response.text()}`);
  return (await response.json()) as Report;
}
