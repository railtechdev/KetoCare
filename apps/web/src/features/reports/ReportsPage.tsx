import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { ReportsView } from "./ReportsView";

/**
 * Отчёт по пациенту за период (раздел 8.3 ТЗ, строка «Отчёт»).
 *
 * Экран показывает то же, что уедет в PDF и в CSV: расхождение между тем, что
 * врач видел, и тем, что напечаталось, — клинический риск. Поэтому и здесь, и
 * там одни и те же числа приходят одним запросом.
 */
export function ReportsPage({ patientId }: { patientId: string }) {
  const { t } = useTranslation("reports");

  return (
    <PageLayout title={t("title")} intro={t("intro")}>
      <ReportsView patientId={patientId} />
    </PageLayout>
  );
}
