import { describe, expect, it } from "vitest";

import {
  HEIGHT_MAX_CM,
  childSchema,
  parseAllergies,
  toChildBody,
  toChildUpdateBody,
} from "./childSchemas";

const VALID = {
  fullName: "Аня Иванова",
  birthDate: "2019-04-12",
  sex: "f" as const,
  heightCm: "121.5",
  allergies: "орехи, молоко",
  notes: "",
};

describe("форма ребёнка", () => {
  it("принимает заполненную форму", () => {
    expect(childSchema.safeParse(VALID).success).toBe(true);
  });

  it("пустой рост допустим: рост можно не знать", () => {
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
