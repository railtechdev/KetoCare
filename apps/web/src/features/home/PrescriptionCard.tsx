import { RatioBadge } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { Panel } from "./Panel";
import type { PrescriptionRead } from "./types";

/** Активное назначение врача — цель, с которой семья сверяет день. */
export function PrescriptionCard({
  prescription,
}: {
  prescription: PrescriptionRead | null;
}) {
  const { t } = useTranslation("home");

  if (prescription === null) {
    return (
      <Panel title={t("prescription.title")}>
        <p className="m-0 text-muted">{t("prescription.empty")}</p>
      </Panel>
    );
  }

  return (
    <Panel title={t("prescription.title")}>
      <dl className="m-0 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted">{t("prescription.ratio")}</dt>
          <dd className="m-0 mt-1">
            {/* Без вердикта о допуске: это назначенная цель, а не измеренный
                результат, сравнивать её не с чем. */}
            <RatioBadge ratio={prescription.ratio} />
          </dd>
        </div>

        <div>
          <dt className="text-sm text-muted">{t("prescription.kcal")}</dt>
          <dd className="m-0 mt-1 tabular-nums">
            {t("prescription.kcalValue", {
              value: prescription.kcal_per_day.toFixed(0),
            })}
          </dd>
        </div>

        <div>
          <dt className="text-sm text-muted">{t("prescription.protein")}</dt>
          <dd className="m-0 mt-1 tabular-nums">
            {t("prescription.gramsValue", { value: prescription.protein_g })}
          </dd>
        </div>

        <div>
          <dt className="text-sm text-muted">{t("prescription.carbsLimit")}</dt>
          <dd className="m-0 mt-1 tabular-nums">
            {t("prescription.gramsValue", {
              value: prescription.carbs_limit_g,
            })}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}
