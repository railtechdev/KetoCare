import {
  formatGrams,
  formatKcal,
  formatMeasured,
  formatOccurredAt,
  formatRatio,
} from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { formatIsoDate } from "../doctor/dates";
import type { PatientReport } from "./useReports";

/**
 * Лист отчёта для печати со страницы (аудит продукта 12.11.2026).
 *
 * Печатается то, что уже пришло на экран, — тот же ответ `/report`, что и
 * блоки над листом: ждать сборки PDF в воркере ради бумаги на приёме незачем.
 * PDF остаётся для файла, который уносят или пересылают.
 *
 * Числа — помощниками кита (правило П45), как на экране: лист и экран об одном
 * и том же периоде обязаны совпадать до запятой.
 */
export function ReportSheet({ report }: { report: PatientReport }) {
  const { t } = useTranslation("reports");
  const date = (iso: string) => formatIsoDate(iso) ?? iso;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <h1 className="m-0 text-lg font-semibold">
        {t("print.title", { name: report.patient.full_name })}
      </h1>
      <p className="m-0">
        {t("print.period", {
          from: date(report.period.from_date),
          to: date(report.period.to_date),
        })}
      </p>

      {report.prescriptions.length > 0 && (
        <section>
          <h2 className="m-0 text-base font-semibold">
            {t("print.prescriptions")}
          </h2>
          <ul className="m-0 pl-4">
            {report.prescriptions.map((item) => (
              <li key={item.created_at}>
                {t("print.prescriptionLine", {
                  from: date(item.effective_from),
                  ratio: formatRatio(item.ratio),
                  kcal: formatKcal(item.kcal_per_day),
                  protein: formatGrams(item.protein_g),
                  carbs: formatGrams(item.carbs_limit_g),
                  meals: item.meals_per_day,
                })}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="m-0 text-base font-semibold">{t("seizures.title")}</h2>
        <p className="m-0">
          {t("seizures.total", {
            count: report.seizures.count,
            entries: report.seizures.entries,
          })}
        </p>
        {report.seizures.by_type.length > 0 && (
          <ul className="m-0 pl-4">
            {report.seizures.by_type.map((item) => (
              <li key={item.seizure_type_id}>
                {item.name_ru}: {item.count}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="m-0 text-base font-semibold">
          {t("measurements.title")}
        </h2>
        {(
          [
            ["ketonesBlood", report.ketones_blood, "unitKetones"],
            ["ketonesUrine", report.ketones_urine, "unitKetones"],
            ["weight", report.weight, "unitWeight"],
          ] as const
        ).map(([key, series, unit]) => (
          <p key={key} className="m-0">
            {t(`measurements.${key}`)}:{" "}
            {series.mean === null
              ? t("measurements.empty")
              : t("measurements.value", {
                  mean: formatMeasured(series.mean),
                  min: formatMeasured(series.min ?? 0),
                  max: formatMeasured(series.max ?? 0),
                  count: series.points.length,
                  unit: t(`measurements.${unit}`),
                })}
          </p>
        ))}
      </section>

      <section>
        <h2 className="m-0 text-base font-semibold">{t("menu.title")}</h2>
        <p className="m-0">
          {t("menu.summary", {
            days: report.menu.days_planned,
            planned: report.menu.items_planned,
            eaten: report.menu.items_eaten,
          })}
        </p>
      </section>

      {report.medications.length > 0 && (
        <section>
          <h2 className="m-0 text-base font-semibold">
            {t("print.medications")}
          </h2>
          <ul className="m-0 pl-4">
            {report.medications.map((item) => (
              <li key={`${item.drug_name}-${item.started_at}`}>
                {item.drug_name}, {item.dose}, {item.frequency}
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.summaries.length > 0 && (
        <section>
          <h2 className="m-0 text-base font-semibold">
            {t("summary.approvedTitle")}
          </h2>
          {report.summaries.map((item) => (
            <p
              key={`${item.period_start}-${item.period_end}`}
              className="m-0 whitespace-pre-line"
            >
              {item.approved_md}
            </p>
          ))}
        </section>
      )}

      <p className="m-0 text-xs">
        {t("print.generated", {
          at: formatOccurredAt(new Date(report.generated_at)),
        })}
      </p>
    </div>
  );
}
