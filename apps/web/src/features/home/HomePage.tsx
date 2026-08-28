import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { usePatientOverview } from "../patients/overview";
import { DayTotalsCard } from "./DayTotalsCard";
import { HomeSkeleton } from "./HomeSkeleton";
import { LatestReadings } from "./LatestReadings";
import { NextMealCard } from "./NextMealCard";
import { PrescriptionCard } from "./PrescriptionCard";
import { QuickActions } from "./QuickActions";
import { SeizuresCard } from "./SeizuresCard";
import { formatOverviewDate } from "./date";

/**
 * Главная родителя (раздел 8.3 ТЗ).
 *
 * Порядок блоков отвечает на вопросы в том порядке, в каком они возникают:
 * что дать сейчас, укладывается ли день в назначение, что с замерами и
 * приступами, к чему всё это сравнивается. Витрины показателей здесь нет
 * намеренно — у семьи один ребёнок, и «сколько всего» ей нечего показать
 * (docs/DESIGN_PROPOSAL.md).
 *
 * Данные сводки приходят одним запросом `/patients/{id}/overview`; ближайший
 * приём пищи — из меню на сегодня.
 */
export function HomePage({ patientId }: { patientId: string }) {
  const { t } = useTranslation("home");
  const overview = usePatientOverview(patientId);

  if (overview.isPending) return <HomeSkeleton />;

  if (overview.error !== null) {
    return (
      <FormError>
        {errorMessageOf(overview.error) ?? t("common:errors.unexpected")}
      </FormError>
    );
  }

  const data = overview.data;
  if (data === undefined) return <HomeSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="m-0 text-2xl font-semibold">{t("title")}</h1>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          {t("date", { date: formatOverviewDate(data.date) })}
        </p>
      </header>

      <QuickActions />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <NextMealCard patientId={patientId} />
          <DayTotalsCard
            day={data.day ?? null}
            targetKcal={data.prescription?.kcal_per_day ?? null}
          />
          <LatestReadings
            ketone={data.last_ketone ?? null}
            weight={data.last_weight ?? null}
          />
        </div>

        <div className="flex flex-col gap-4">
          <PrescriptionCard prescription={data.prescription ?? null} />
          <SeizuresCard seizures={data.seizures_today} />
        </div>
      </div>
    </div>
  );
}
