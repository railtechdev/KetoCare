import type { components } from "@ketocare/api-client";

type Patient = components["schemas"]["PatientRead"];

/**
 * Что показывать в строке «Аллергии».
 *
 * Поле `allergies` хранит идентификаторы продуктов вперемешку со свободными
 * метками, и показывать его как есть нельзя: в карте пациента у врача так и
 * стояло «dcf7df2c-349b-42f8-bfb4-886ebc6ea111, цитрусовые» — то есть мусор
 * ровно в том поле, по которому решают, что ребёнку можно.
 *
 * Разбор делает сервер (`excluded_products` + `allergy_labels`); здесь только
 * сборка строки — одна на все экраны, потому что второй такой же уже разошёлся
 * с первым.
 */
export function allergyNames(
  patient: Pick<Patient, "excluded_products" | "allergy_labels">,
  unknownProduct: string,
): string[] {
  // Оба поля со значением по умолчанию на сервере, но здесь они всё равно
  // подстрахованы: во время выката фронт какое-то время говорит со старым API,
  // и разбор ответа не должен ронять карту пациента целиком — ровно это и
  // случилось на тесте со старой заготовкой ответа.
  return [
    ...(patient.excluded_products ?? []).map(
      (entry) => entry.name_ru ?? unknownProduct,
    ),
    ...(patient.allergy_labels ?? []),
  ];
}
