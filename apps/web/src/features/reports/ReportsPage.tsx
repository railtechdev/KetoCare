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
    // Отчёт — числа и таблицы, страница для работы (правило П34 канона).
    <PageLayout title={t("title")} intro={t("intro")} width="wide">
      <ReportsView patientId={patientId} />
    </PageLayout>
  );
}
