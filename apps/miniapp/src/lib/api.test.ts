import { NetworkError } from "@ketocare/api-client";
import { describe, expect, it } from "vitest";

import { errorMessageOf } from "./api";

describe("объяснение отказа в Mini App", () => {
  it("отказ сети называет связь", () => {
    expect(errorMessageOf(new NetworkError())).toBe(
      "Нет связи с сервером. Проверьте подключение.",
    );
  });

  it("сообщение сервера отдаётся как есть, ошибка в коде — без объяснения", () => {
    expect(
      errorMessageOf({ error: { code: "internal", message: "Сбой." } }),
    ).toBe("Сбой.");
    expect(errorMessageOf(new TypeError("x"))).toBeNull();
  });
});
