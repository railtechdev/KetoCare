import { NetworkError } from "@ketocare/api-client";
import { describe, expect, it } from "vitest";

import { errorMessageOf } from "./api";

describe("объяснение отказа", () => {
  it("отказ сети называет связь, а не «что-то пошло не так»", () => {
    expect(errorMessageOf(new NetworkError())).toBe(
      "Нет связи с сервером. Проверьте подключение.",
    );
  });

  it("сообщение сервера отдаётся как есть", () => {
    expect(
      errorMessageOf({ error: { code: "conflict", message: "Уже есть." } }),
    ).toBe("Уже есть.");
  });

  it("ошибка в коде объяснения не получает", () => {
    expect(errorMessageOf(new TypeError("x is not a function"))).toBeNull();
  });
});
