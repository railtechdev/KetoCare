import { EmptyState, RatioBadge } from "@ketocare/ui";
import { ClipboardList } from "lucide-react";
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
        {/* Без кнопки действия намеренно: назначение задаёт врач, семье здесь
            нечего нажать — обещать ей выход было бы неправдой. */}
        <EmptyState
          icon={ClipboardList}
          title={t("prescription.emptyTitle")}
          description={t("prescription.empty")}
        />
      </Panel>
    );
  }

  return (
    <Panel title={t("prescription.title")}>
      <dl className="m-0 grid gap-block sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">
            {t("prescription.ratio")}
          </dt>
          <dd className="m-0 mt-1">
            {/* Без вердикта о допуске: это назначенная цель, а не измеренный
                результат, сравнивать её не с чем. */}
            <RatioBadge ratio={prescription.ratio} />
          </dd>
        </div>

        <div>
          <dt className="text-sm text-muted-foreground">
            {t("prescription.kcal")}
          </dt>
          <dd className="m-0 mt-1 tabular-nums">
            {t("prescription.kcalValue", {
              value: prescription.kcal_per_day.toFixed(0),
            })}
          </dd>
        </div>

        <div>
          <dt className="text-sm text-muted-foreground">
            {t("prescription.protein")}
          </dt>
          <dd className="m-0 mt-1 tabular-nums">
            {t("prescription.gramsValue", { value: prescription.protein_g })}
          </dd>
        </div>

        <div>
          <dt className="text-sm text-muted-foreground">
            {t("prescription.carbsLimit")}
          </dt>
          <dd className="m-0 mt-1 tabular-nums">
            {t("prescription.gramsValue", {
              value: prescription.carbs_limit_g,
            })}
          </dd>
        </div>

        {/* Число приёмов врач задаёт с первого назначения, а семье его до сих
            пор не показывали нигде — при том что план дня составляет она. */}
        <div>
          <dt className="text-sm text-muted-foreground">
            {t("prescription.meals")}
          </dt>
          <dd className="m-0 mt-1 tabular-nums">
            {prescription.meals_per_day}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}
