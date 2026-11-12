import type { components } from "@ketocare/api-client";
import { formatMass, formatPerGram } from "@ketocare/ui";
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
  options: {
    /**
     * Числа на 1 г — в карточке продукта, где и поля на 1 г (ADR-0065,
     * ADR-0073). Сервер считает и отдаёт на 100 г; список подозрительных и
     * отчёт загрузки читают так же, как источник.
     */
    perGram?: boolean;
  } = {},
): string {
  // Числа — русской записью и с той точностью, что пришла (П45). Округлять
  // до целых нельзя даже калорийность: находка «расхождение больше 5 ккал»
  // при «заявлено 520, выходит 525» читалась бы как спор с самой собой.
  const values = Object.fromEntries(
    Object.entries(item.values).map(([key, value]) => [
      key,
      options.perGram ? formatPerGram(value) : formatMass(value),
    ]),
  );
  const branch = options.perGram ? "detailPerGram" : "detail";
  return t(`products.anomalies.${branch}.${item.kind}`, {
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
