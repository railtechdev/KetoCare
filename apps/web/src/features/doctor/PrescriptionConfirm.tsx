import {
  Fact,
  FactList,
  formatMass,
  formatKcal,
  formatRatio,
} from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { formatIsoDate } from "./dates";
import type { PrescriptionFormValues } from "./prescriptionSchema";
import type { Prescription } from "./types";

/** Одна строка сводки: новое значение и прежнее рядом, если оно другое. */
interface Row {
  key: string;
  label: string;
  value: string;
  previous: string | null;
}

/**
 * Что врач подтверждает: значения новой версии назначения.
 *
 * Ответ клиники от 09.09.2026 на вопрос 5: «После назначения врача можно
 * сделать окно: подтвердите подпись или назначение». Назначение не правится —
 * только перекрывается новой версией, — и опечатка в калорийности уходит семье
 * в тот же день. Окно показывает все шесть показателей разом, и у изменённых
 * рядом стоит прежнее значение: правку одного поля из шести глаз иначе не
 * находит.
 */
export function PrescriptionConfirm({
  values,
  previous,
}: {
  values: PrescriptionFormValues;
  /** Действующая версия; `null` — назначение первое, сравнивать не с чем */
  previous: Prescription | null;
}) {
  const { t } = useTranslation("doctor");

  const date = (value: string) => formatIsoDate(value) ?? value;
  const rows: Row[] = [
    {
      key: "ratio",
      label: t("fields.ratio"),
      value: formatRatio(values.ratio),
      previous: previous === null ? null : formatRatio(previous.ratio),
    },
    {
      key: "kcal",
      label: t("fields.kcal"),
      value: t("prescription.confirm.kcal", {
        value: formatKcal(values.kcalPerDay),
      }),
      previous:
        previous === null
          ? null
          : t("prescription.confirm.kcal", {
              value: formatKcal(previous.kcal_per_day),
            }),
    },
    {
      key: "protein",
      label: t("fields.protein"),
      value: t("prescription.confirm.grams", {
        value: formatMass(values.proteinG),
      }),
      previous:
        previous === null
          ? null
          : t("prescription.confirm.grams", {
              value: formatMass(previous.protein_g),
            }),
    },
    {
      key: "carbs",
      label: t("fields.carbsLimit"),
      value: t("prescription.confirm.grams", {
        value: formatMass(values.carbsLimitG),
      }),
      previous:
        previous === null
          ? null
          : t("prescription.confirm.grams", {
              value: formatMass(previous.carbs_limit_g),
            }),
    },
    {
      key: "meals",
      label: t("fields.meals"),
      value: String(values.mealsPerDay),
      previous: previous === null ? null : String(previous.meals_per_day),
    },
    {
      key: "effectiveFrom",
      label: t("fields.effectiveFrom"),
      value: date(values.effectiveFrom),
      previous: previous === null ? null : date(previous.effective_from),
    },
  ];

  return (
    <FactList label={t("prescription.confirm.listLabel")}>
      {rows.map((row) => (
        <Fact
          key={row.key}
          label={row.label}
          value={
            row.previous !== null && row.previous !== row.value ? (
              <>
                <strong className="font-semibold">{row.value}</strong>{" "}
                <span className="text-muted-foreground">
                  {t("prescription.confirm.previous", { value: row.previous })}
                </span>
              </>
            ) : (
              row.value
            )
          }
        />
      ))}
    </FactList>
  );
}
