import { describe, expect, it } from "vitest";

import { prescriptionHistoryKey, prescriptionsKey } from "./doctorQueries";

/**
 * Регрессия: два хука ходили по одному адресу API с ОДНИМ ключом кэша, но
 * отдавали разные формы — `usePrescriptionVersions` массив версий,
 * `usePrescriptionHistory` объект `{ versions, total }`.
 *
 * На карте пациента вкладка «Назначение» клала в ячейку объект, а вкладка
 * «Дневники» читала его как массив и падала с `.filter is not a function`.
 * Ни типы, ни тесты компонентов этого не ловили: каждый хук объявляет свой
 * возвращаемый тип, а ключ кэша — просто массив строк. Нашлось только осмотром
 * работающего приложения в браузере.
 */
describe("ключи кэша назначений", () => {
  const patientId = "11111111-1111-4111-8111-111111111111";

  it("история и список версий не делят одну ячейку кэша", () => {
    expect(prescriptionHistoryKey(patientId)).not.toEqual(
      prescriptionsKey(patientId),
    );
  });

  it("история остаётся под префиксом списка — инвалидация накрывает обе", () => {
    // TanStack Query сверяет ключи по префиксу: `invalidateQueries` с коротким
    // ключом обязан сбрасывать и историю, иначе после создания назначения
    // таблица версий осталась бы прежней.
    const prefix = prescriptionsKey(patientId);
    expect(prescriptionHistoryKey(patientId).slice(0, prefix.length)).toEqual([
      ...prefix,
    ]);
  });
});
