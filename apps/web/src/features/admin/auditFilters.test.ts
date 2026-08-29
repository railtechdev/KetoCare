import { describe, expect, it } from "vitest";

import {
  AUDIT_PAGE_SIZE,
  EMPTY_AUDIT_FILTERS,
  endOfDayIso,
  isRangeInvalid,
  isUserIdInvalid,
  startOfDayIso,
  toAuditQuery,
} from "./auditFilters";

describe("isUserIdInvalid", () => {
  it("пустое поле — это отсутствие фильтра, а не ошибка", () => {
    expect(isUserIdInvalid(EMPTY_AUDIT_FILTERS)).toBe(false);
  });

  it("ловит идентификатор, который сервер отклонит", () => {
    expect(isUserIdInvalid({ ...EMPTY_AUDIT_FILTERS, userId: "иванов" })).toBe(
      true,
    );
  });

  it("пропускает UUID", () => {
    expect(
      isUserIdInvalid({
        ...EMPTY_AUDIT_FILTERS,
        userId: " 0f8fad5b-d9cb-469f-a165-70867728950e ",
      }),
    ).toBe(false);
  });
});

describe("isRangeInvalid", () => {
  it("ловит период с началом позже конца", () => {
    expect(
      isRangeInvalid({
        ...EMPTY_AUDIT_FILTERS,
        from: "2026-08-10",
        to: "2026-08-01",
      }),
    ).toBe(true);
  });

  it("одна заданная граница периодом не является", () => {
    expect(isRangeInvalid({ ...EMPTY_AUDIT_FILTERS, from: "2026-08-10" })).toBe(
      false,
    );
  });
});

describe("границы периода", () => {
  it("начало дня — местная полночь", () => {
    const iso = startOfDayIso("2026-08-01");
    expect(iso).toBeDefined();

    // Сравнение идёт с местным временем, а не со строкой: смещение зоны в CI и
    // на машине разработчика разное, но полночь остаётся полночью.
    const parsed = new Date(iso as string);
    expect(parsed.getHours()).toBe(0);
    expect(parsed.getMinutes()).toBe(0);
    expect(parsed.getDate()).toBe(1);
  });

  it("конец дня включает последнюю миллисекунду", () => {
    const parsed = new Date(endOfDayIso("2026-08-01") as string);

    expect(parsed.getHours()).toBe(23);
    expect(parsed.getMinutes()).toBe(59);
    expect(parsed.getMilliseconds()).toBe(999);
  });

  it("незаданная граница не превращается в дату", () => {
    expect(startOfDayIso("")).toBeUndefined();
    expect(endOfDayIso("")).toBeUndefined();
  });
});

describe("toAuditQuery", () => {
  it("не отправляет незаполненные фильтры", () => {
    const query = toAuditQuery(EMPTY_AUDIT_FILTERS, 0);

    expect(query).toEqual({
      user_id: undefined,
      entity: undefined,
      action: undefined,
      from: undefined,
      to: undefined,
      limit: AUDIT_PAGE_SIZE,
      offset: 0,
    });
  });

  it("переносит заполненные фильтры и смещение страницы", () => {
    const query = toAuditQuery(
      {
        userId: " 0f8fad5b-d9cb-469f-a165-70867728950e ",
        entity: "products",
        action: "update",
        from: "2026-08-01",
        to: "2026-08-31",
      },
      AUDIT_PAGE_SIZE,
    );

    expect(query.user_id).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(query.entity).toBe("products");
    expect(query.action).toBe("update");
    expect(query.offset).toBe(AUDIT_PAGE_SIZE);
    expect(query.from).toBeDefined();
    expect(query.to).toBeDefined();
  });
});
