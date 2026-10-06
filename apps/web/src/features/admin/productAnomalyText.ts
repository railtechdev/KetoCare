import type { components } from "@ketocare/api-client";
import type { TFunction } from "i18next";

export type ProductAnomaly = components["schemas"]["ProductAnomalyRead"];

/**
 * Пояснение к находке: класс и числа приходят с сервера, фраза собирается из
 * словаря (правило 8 CLAUDE.md).
 *
 * Одно место на три экрана — список подозрительных, карточку продукта и
 * превью импорта: одна и та же находка, названная по-разному в трёх местах,
 * читалась бы как три разных.
 */
export function anomalyDetail(
  t: TFunction<"admin">,
  item: Pick<ProductAnomaly, "kind" | "values"> & { field?: string },
): string {
  return t(`products.anomalies.detail.${item.kind}`, {
    ...item.values,
    field: item.field
      ? t(`products.anomalies.field.${item.field}`, {
          defaultValue: item.field,
        })
      : "",
    defaultValue: "",
  });
}

/** Название класса находки; незнакомый класс — общее «требует проверки». */
export function anomalyKind(t: TFunction<"admin">, kind: string): string {
  return t(`products.anomalies.kind.${kind}`, {
    defaultValue: t("products.anomalies.kind.other"),
  });
}
