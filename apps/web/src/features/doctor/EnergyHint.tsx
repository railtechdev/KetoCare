import {
  Button,
  formatKcal,
  formatOccurredAt,
  formatWeight,
} from "@ketocare/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { api } from "../../lib/api";
import { usePatient } from "../patients/usePatient";
import { usePatientOverview } from "../patients/overview";
import { ageInMonths } from "./dates";

/**
 * Суточная калорийность по весу и возрасту (вопрос 56, таблица Yonsei).
 *
 * Считает ядро через API: таблица — медицинская константа. Подсказка ничего не
 * подставляет сама: число в поле вводит врач, кнопка лишь переносит середину
 * диапазона, округлённую до 10 ккал.
 */
export function EnergyHint({
  patientId,
  onApply,
}: {
  patientId: string;
  onApply: (kcal: number) => void;
}) {
  const { t } = useTranslation("doctor");
  const patient = usePatient(patientId);
  const weight = usePatientOverview(patientId).data?.last_weight ?? null;
  const months =
    patient.data?.birth_date != null
      ? ageInMonths(patient.data.birth_date, new Date())
      : null;
  const years = months === null ? null : Math.floor(months / 12);

  const range = useQuery({
    // weight:raw — число уходит в расчёт, а не на экран.
    queryKey: ["calc", "energy", years, weight?.weight_kg],
    enabled: years !== null && weight !== null,
    queryFn: async () => {
      const { data, error } = await api.POST(
        "/api/v1/calc/energy-requirement",
        {
          body: {
            age_years: years as number,
            // weight:raw — число уходит в расчёт, а не на экран.
            weight_kg: (weight as { weight_kg: number }).weight_kg,
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty energy response");
      return data;
    },
  });

  if (weight === null) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        {t("prescription.energy.noWeight")}
      </p>
    );
  }
  if (years === null) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        {t("prescription.energy.noBirthDate")}
      </p>
    );
  }
  if (range.isError) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        {t("prescription.energy.failed")}
      </p>
    );
  }
  if (range.data === undefined) return null;

  const middle =
    Math.round((range.data.kcal_min + range.data.kcal_max) / 20) * 10;

  return (
    <div className="flex flex-wrap items-center gap-field text-sm">
      <p className="m-0">
        {t("prescription.energy.range", {
          weight: formatWeight(weight.weight_kg),
          // Дата взвешивания рядом: по устаревшему весу подставили бы не то.
          at: formatOccurredAt(new Date(weight.occurred_at)),
          age: t("age.years", { count: years }),
          min: formatKcal(range.data.kcal_min),
          max: formatKcal(range.data.kcal_max),
        })}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onApply(middle)}
      >
        {t("prescription.energy.apply", { kcal: formatKcal(middle) })}
      </Button>
    </div>
  );
}
