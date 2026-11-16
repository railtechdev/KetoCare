import {
  Button,
  formatKcal,
  formatMass,
  formatOccurredAt,
  formatWeight,
  RECALC_DELAY_MS,
  useDebouncedValue,
} from "@ketocare/ui";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { api } from "../../lib/api";
import { usePatient } from "../patients/usePatient";
import { usePatientOverview } from "../patients/overview";
import { ageInMonths } from "./dates";

/** Тот же предел, что у схемы `/calc/energy-requirement`. */
const MAX_WEIGHT_KG = 200;

/** Что подсказка ставит в форму назначения. */
export interface EnergyHintValues {
  kcal: number;
  /** Белок по весу и возрасту (вопрос 59, ADR-0085). */
  proteinG: number;
  /** Строка таблицы белка, г на кг: подпись под полем называет её. */
  proteinPerKg: number;
  /** Жидкость по весу (Холлидей — Сегар, ADR-0069). */
  fluidMl: number;
}

function parseWeight(text: string): number | null {
  const value = Number(text.replace(",", ".").trim());
  if (text.trim() === "" || !Number.isFinite(value)) return null;
  return value > 0 && value <= MAX_WEIGHT_KG ? value : null;
}

/**
 * Суточная калорийность, белок и жидкость по весу и возрасту (вопросы 56, 59).
 *
 * Считает ядро через API: таблицы — медицинские константы. Подсказка ничего не
 * подставляет сама: врач выбирает минимум, середину или максимум диапазона.
 *
 * Вес для расчёта — последнее взвешивание, но врач может его поменять (ответ
 * клиники на вопрос 61 от 16.11.2026: ослабленному ребёнку «добавляют» кг).
 * Поменянный вес живёт только в этой форме: в назначение уходят посчитанные
 * числа, а запись о весе ребёнка остаётся настоящей — подменять измеренное
 * нельзя (ADR-0085).
 */
export function EnergyHint({
  patientId,
  onApply,
}: {
  patientId: string;
  onApply: (values: EnergyHintValues) => void;
}) {
  const { t } = useTranslation("doctor");
  const id = useId();
  const patient = usePatient(patientId);
  const measured = usePatientOverview(patientId).data?.last_weight ?? null;
  const months =
    patient.data?.birth_date != null
      ? ageInMonths(patient.data.birth_date, new Date())
      : null;
  const years = months === null ? null : Math.floor(months / 12);

  // null — врач поле не трогал, считаем от последнего взвешивания.
  const [typed, setTyped] = useState<string | null>(null);
  // weight:raw — значение поля ввода, а не текст на экране.
  const weightText =
    typed ?? (measured === null ? "" : String(measured.weight_kg));
  const weight = parseWeight(weightText);
  // Расчёт — по набранному числу, а не по каждой клавише: пока врач набирает
  // «25», на «2» появились бы кнопки с калориями для 2 кг.
  const settled = useDebouncedValue(weight, RECALC_DELAY_MS);
  // weight:raw — сравнение чисел, не показ.
  const changed =
    typed !== null && measured !== null && weight !== measured.weight_kg;

  const range = useQuery({
    // weight:raw — число уходит в расчёт, а не на экран.
    queryKey: ["calc", "energy", years, settled],
    enabled: years !== null && settled !== null && settled === weight,
    queryFn: async () => {
      const { data, error } = await api.POST(
        "/api/v1/calc/energy-requirement",
        {
          body: {
            age_years: years as number,
            // weight:raw — число уходит в расчёт, а не на экран.
            weight_kg: settled as number,
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty energy response");
      return data;
    },
  });

  if (years === null) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        {t("prescription.energy.noBirthDate")}
      </p>
    );
  }

  const weightHint =
    measured === null ? (
      t("prescription.energy.noWeight")
    ) : changed ? (
      <>
        {t("prescription.energy.weightChanged", {
          weight: formatWeight(measured.weight_kg),
          at: formatOccurredAt(new Date(measured.occurred_at)),
        })}{" "}
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={() => setTyped(null)}
        >
          {t("prescription.energy.weightReset", {
            weight: formatWeight(measured.weight_kg),
          })}
        </Button>
      </>
    ) : (
      // Дата взвешивания рядом: по устаревшему весу подставили бы не то.
      t("prescription.energy.weightMeasured", {
        at: formatOccurredAt(new Date(measured.occurred_at)),
      })
    );

  // Кнопки — только по ответу на то число, что стоит в поле сейчас.
  const data = weight !== null && settled === weight ? range.data : undefined;
  // Три варианта, как в KDC: врач выбирает по телосложению ребёнка. Числа —
  // целые ккал, середина округлена до 10.
  const low = data === undefined ? 0 : Math.round(data.kcal_min);
  const high = data === undefined ? 0 : Math.round(data.kcal_max);
  const options = [
    { key: "min", kcal: low },
    { key: "middle", kcal: Math.round((low + high) / 20) * 10 },
    { key: "max", kcal: high },
  ] as const;

  return (
    <div className="flex flex-col gap-field text-sm">
      <Field
        id={`${id}-weight`}
        width="narrow"
        type="number"
        inputMode="decimal"
        min={0.1}
        max={MAX_WEIGHT_KG}
        step={0.1}
        label={t("prescription.energy.weightLabel")}
        hint={weightHint}
        error={
          weightText.trim() !== "" && weight === null
            ? t("prescription.energy.weightInvalid")
            : undefined
        }
        value={weightText}
        onChange={(event) => setTyped(event.target.value)}
        // Enter в этом поле не отправляет назначение: оно не часть формы.
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
      {range.isError && weight !== null ? (
        <p className="m-0 text-muted-foreground">
          {t("prescription.energy.failed")}
        </p>
      ) : data === undefined ? null : (
        <div className="flex flex-wrap items-center gap-field">
          <p className="m-0">
            {t("prescription.energy.range", {
              weight: formatWeight(weight as number),
              age: t("age.years", { count: years }),
              // Строка таблицы по возрасту рядом с итогом: без неё двое детей
              // одного веса с разными суммами выглядели ошибкой расчёта
              // (замечание диетолога 12.11.2026).
              perKgMin: formatKcal(data.kcal_per_kg_min),
              perKgMax: formatKcal(data.kcal_per_kg_max),
              min: formatKcal(data.kcal_min),
              max: formatKcal(data.kcal_max),
              proteinPerKg: formatMass(data.protein_g_per_kg),
              protein: formatMass(data.protein_g),
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
                  onApply({
                    kcal: option.kcal,
                    proteinG: Math.round(data.protein_g * 10) / 10,
                    proteinPerKg: data.protein_g_per_kg,
                    // Целые миллилитры: поле назначения хранит целое число.
                    fluidMl: Math.round(data.fluid_ml),
                  })
                }
              >
                {t(`prescription.energy.${option.key}`, {
                  kcal: formatKcal(option.kcal),
                })}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
