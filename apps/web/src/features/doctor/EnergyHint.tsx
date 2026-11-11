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
 * подставляет сама: врач выбирает минимум, середину или максимум диапазона.
 */
export function EnergyHint({
  patientId,
  onApply,
}: {
  patientId: string;
  /**
   * Калорийность, белок по весу (1 г на кг, ответ клиники 11.11.2026) и
   * жидкость по весу (Холлидей — Сегар, ADR-0069).
   */
  onApply: (kcal: number, proteinG: number, fluidMl: number) => void;
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

  // Три варианта, как в KDC: врач выбирает по телосложению ребёнка. Числа —
  // целые ккал, середина округлена до 10.
  const low = Math.round(range.data.kcal_min);
  const high = Math.round(range.data.kcal_max);
  const options = [
    { key: "min", kcal: low },
    { key: "middle", kcal: Math.round((low + high) / 20) * 10 },
    { key: "max", kcal: high },
  ] as const;

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
      <div className="flex flex-wrap gap-field">
        {options.map((option) => (
          <Button
            key={option.key}
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onApply(
                option.kcal,
                Math.round(range.data.protein_g * 10) / 10,
                // Целые миллилитры: поле назначения хранит целое число.
                Math.round(range.data.fluid_ml),
              )
            }
          >
            {t(`prescription.energy.${option.key}`, {
              kcal: formatKcal(option.kcal),
            })}
          </Button>
        ))}
      </div>
    </div>
  );
}
