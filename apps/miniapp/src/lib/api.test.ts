import { NetworkError } from "@ketocare/api-client";
import { describe, expect, it } from "vitest";

import { errorMessageOf } from "./api";

describe("объяснение отказа в Mini App", () => {
  it("отказ сети называет связь", () => {
    expect(errorMessageOf(new NetworkError())).toBe(
      "Нет связи. Проверьте интернет.",
    );
  });

  it("сообщение сервера отдаётся как есть, ошибка в коде — без объяснения", () => {
    expect(
      errorMessageOf({ error: { code: "internal", message: "Сбой." } }),
    ).toBe("Сбой.");
    expect(errorMessageOf(new TypeError("x"))).toBeNull();
  });

  it("ответ не нашим конвертом — сбой у нас, а не связь семьи (2.20)", () => {
    expect(errorMessageOf("<html>502 Bad Gateway</html>")).toBe(
      "Приложение сейчас недоступно — это не из-за вашей связи. Попробуйте через несколько минут.",
    );
    expect(errorMessageOf({})).toMatch(/не из-за вашей связи/);
    // Наш конверт без сообщения — слово за экраном.
    expect(errorMessageOf({ error: { code: "internal" } })).toBeNull();
  });
});
