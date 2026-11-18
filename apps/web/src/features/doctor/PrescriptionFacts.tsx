import {
  FactList,
  formatGrams,
  formatKcal,
  formatNumber,
  RatioBadge,
} from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { formatIsoDate } from "./dates";
import type { Prescription } from "./types";

/**
 * The prescription as read-only facts.
 *
 * One block for the card overview and the «Назначение» section (UI audit of
 * 2026-11-18, Р2): the section used to show the prescription straight as input
 * fields, and a number was easy to change by accident.
 */
export function PrescriptionFacts({
  prescription,
}: {
  prescription: Prescription;
}) {
  const { t } = useTranslation("doctor");

  return (
    <FactList>
      <dt className="text-muted-foreground">{t("fields.ratio")}</dt>
      <dd className="m-0">
        {/* Вердикт о допуске здесь не показывается: это сама цель
            назначения, а не измерение, которое с ней сравнивают. */}
        <RatioBadge ratio={prescription.ratio} />
      </dd>

      <dt className="text-muted-foreground">{t("fields.kcal")}</dt>
      <dd className="m-0 tabular-nums">
        {t("units.kcalPerDay", {
          value: formatKcal(prescription.kcal_per_day),
        })}
      </dd>

      <dt className="text-muted-foreground">{t("fields.protein")}</dt>
      <dd className="m-0 tabular-nums">
        {t("units.gramsPerDay", {
          value: formatGrams(prescription.protein_g),
        })}
      </dd>

      <dt className="text-muted-foreground">{t("fields.carbsLimit")}</dt>
      <dd className="m-0 tabular-nums">
        {t("units.gramsPerDay", {
          value: formatGrams(prescription.carbs_limit_g),
        })}
      </dd>

      <dt className="text-muted-foreground">{t("fields.meals")}</dt>
      <dd className="m-0 tabular-nums">{prescription.meals_per_day}</dd>

      {/* Жидкость необязательна (ADR-0069): не задана — строки нет. */}
      {prescription.fluid_ml_per_day != null && (
        <>
          <dt className="text-muted-foreground">{t("fields.fluid")}</dt>
          <dd className="m-0 tabular-nums">
            {t("units.mlPerDay", {
              value: formatNumber(prescription.fluid_ml_per_day, 0),
            })}
          </dd>
        </>
      )}

      <dt className="text-muted-foreground">{t("fields.effectiveFrom")}</dt>
      <dd className="m-0 tabular-nums">
        {formatIsoDate(prescription.effective_from) ?? "—"}
      </dd>

      {prescription.restrictions !== null && (
        <>
          <dt className="text-muted-foreground">{t("fields.restrictions")}</dt>
          <dd className="m-0">{prescription.restrictions}</dd>
        </>
      )}
    </FactList>
  );
}
