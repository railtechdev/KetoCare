import { describe, expect, it } from "vitest";

import {
  HEIGHT_MAX_CM,
  childSchema,
  newChildSchema,
  parseAllergies,
  toChildBody,
  looksLikeProductId,
  splitExclusions,
  toChildUpdateBody,
} from "./childSchemas";

const VALID = {
  fullName: "Аня Иванова",
  birthDate: "2019-04-12",
  sex: "f" as const,
  heightCm: "121.5",
  weightKg: "",
  allergies: "орехи, молоко",
  excludedProductIds: [],
  notes: "",
};

describe("форма ребёнка", () => {
  it("принимает заполненную форму", () => {
    expect(childSchema.safeParse(VALID).success).toBe(true);
  });

  it("пол не выбран — карта не сохраняется (аудит 12.11.2026)", () => {
    // Умолчание «Мальчик» сохраняло девочек мальчиками, а пол после создания
    // карты не меняется: по нему считается оценка роста по ВОЗ.
    const result = newChildSchema.safeParse({
      ...VALID,
      weightKg: "21",
      sex: "",
    } as unknown);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain("sex");
  });

  it("новая карта требует рост и вес (замечание диетолога 12.11.2026)", () => {
    const filled = { ...VALID, weightKg: "23" };
    expect(newChildSchema.safeParse(filled).success).toBe(true);
    expect(newChildSchema.safeParse({ ...filled, weightKg: "" }).success).toBe(
      false,
    );
    expect(newChildSchema.safeParse({ ...filled, heightCm: "" }).success).toBe(
      false,
    );
  });

  it("при правке карты пустой рост допустим: в старой карте его могли не записать", () => {
    expect(childSchema.safeParse({ ...VALID, heightCm: "" }).success).toBe(
      true,
    );
  });

  it("отвергает невозможный рост", () => {
    for (const heightCm of ["0", "-3", String(HEIGHT_MAX_CM + 1), "сто"]) {
      expect(childSchema.safeParse({ ...VALID, heightCm }).success).toBe(false);
    }
  });

  it("отвергает чужой формат даты", () => {
    expect(
      childSchema.safeParse({ ...VALID, birthDate: "12.04.2019" }).success,
    ).toBe(false);
  });
});

describe("toChildBody", () => {
  it("собирает тело запроса из значений формы", () => {
    // Схема только проверяет и ничего не преобразует, поэтому сборка тела —
    // единственное место, где строки становятся числами и null. Пока разбор жил
    // в схеме, эта функция разбирала уже разобранное и падала на собственном
    // результате: форма молча не отправлялась и ошибки не показывала.
    expect(toChildBody(childSchema.parse(VALID))).toEqual({
      full_name: "Аня Иванова",
      birth_date: "2019-04-12",
      sex: "f",
      height_cm: 121.5,
      weight_kg: null,
      allergies: ["орехи", "молоко"],
      notes: null,
    });
  });

  it("пустой рост уходит как «не указано», а не как ноль", () => {
    const body = toChildBody(childSchema.parse({ ...VALID, heightCm: "  " }));
    expect(body.height_cm).toBeNull();
  });

  it("тело правки не несёт дату рождения и пол", () => {
    // Возраст уже вошёл в сделанные расчёты; менять его задним числом нельзя.
    const body = toChildUpdateBody(childSchema.parse(VALID));
    expect(body).not.toHaveProperty("birth_date");
    expect(body).not.toHaveProperty("sex");
    expect(body.height_cm).toBe(121.5);
  });
});

describe("parseAllergies", () => {
  it("разбирает список через запятую и выбрасывает пустые", () => {
    expect(parseAllergies(" орехи , , молоко ")).toEqual(["орехи", "молоко"]);
  });

  it("пустая строка — пустой список, а не список из пустой строки", () => {
    expect(parseAllergies("   ")).toEqual([]);
  });
});

describe("исключения ребёнка", () => {
  const PEANUT = "11111111-1111-4111-8111-111111111111";

  it("делит хранимое поле на продукты и свободные метки", () => {
    // Поле хранит и то и другое (раздел 4.2 ТЗ). Свободная метка «орехи»
    // сопоставима только с глазами человека; продукт — ссылка на каталог, и
    // только по ней подбор раскладки узнаёт об исключении.
    expect(splitExclusions([PEANUT, "орехи", "  "])).toEqual({
      productIds: [PEANUT],
      labels: ["орехи"],
    });
  });

  it("собирает поле обратно: продукты и метки вместе", () => {
    expect(
      toChildBody({ ...VALID, excludedProductIds: [PEANUT] }).allergies,
    ).toEqual([PEANUT, "орехи", "молоко"]);
  });

  it("не принимает идентификатор за метку и наоборот", () => {
    expect(looksLikeProductId(PEANUT)).toBe(true);
    expect(looksLikeProductId("орехи")).toBe(false);
    // Правило то же, что на сервере: разные правила означали бы, что часть
    // системы считает исключение меткой, а часть — продуктом.
    expect(looksLikeProductId("11111111-1111-4111-8111")).toBe(false);
  });
});
