import type { components } from "@ketocare/api-client";
import { formatMass } from "@ketocare/ui";
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
  // Числа — русской записью и с той точностью, что пришла (П45). Округлять
  // до целых нельзя даже калорийность: находка «расхождение больше 5 ккал»
  // при «заявлено 520, выходит 525» читалась бы как спор с самой собой.
  const values = Object.fromEntries(
    Object.entries(item.values).map(([key, value]) => [key, formatMass(value)]),
  );
  return t(`products.anomalies.detail.${item.kind}`, {
    ...values,
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
