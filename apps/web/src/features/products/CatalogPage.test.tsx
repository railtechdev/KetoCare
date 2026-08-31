import { describe, expect, it } from "vitest";

import { canEditCatalog } from "./types";

/**
 * Роль, чья работа — вести каталог, не могла в нём ничего изменить: сервер
 * разрешал диетологу заводить и править продукты, а кабинет отдавал ему тот же
 * экран на чтение, что и родителю.
 *
 * Список ролей обязан совпадать с `_EDITOR_ROLES` в
 * `apps/api/src/api/routers/products.py`. Расхождение здесь не откроет лишнего
 * (право проверяет сервер), но приведёт человека к кнопке, за которой 403.
 */
describe("кто правит справочник продуктов", () => {
  it.each(["admin", "dietitian"] as const)("%s правит", (role) => {
    expect(canEditCatalog(role)).toBe(true);
  });

  it.each(["doctor", "parent"] as const)("%s только читает", (role) => {
    expect(canEditCatalog(role)).toBe(false);
  });

  it("роль неизвестна — правки нет", () => {
    expect(canEditCatalog(undefined)).toBe(false);
  });
});
