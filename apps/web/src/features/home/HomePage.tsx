import { AsyncSection } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
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
  const data = overview.data;

  return (
    <PageLayout
      title={t("title")}
      // Дата известна только вместе со сводкой: до ответа подпись пустая,
      // а не подставленная клиентом — сутки считает сервер по своей зоне.
      intro={
        data === undefined
          ? undefined
          : t("date", { date: formatOverviewDate(data.date) })
      }
    >
      {/* Четыре состояния — в AsyncSection: там же записано, почему неудачное
          обновление не должно прятать уже показанную сводку. */}
      <AsyncSection
        loading={overview.isLoading}
        skeleton={<HomeSkeleton />}
        error={
          overview.isError
            ? {
                title: t("loadError"),
                description:
                  errorMessageOf(overview.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void overview.refetch()}
        isEmpty={data === undefined}
        empty={null}
      >
        {data !== undefined && (
          <>
            <QuickActions />

            <div className="grid gap-block lg:grid-cols-3">
              <div className="flex flex-col gap-block lg:col-span-2">
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

              <div className="flex flex-col gap-block">
                <PrescriptionCard prescription={data.prescription ?? null} />
                <SeizuresCard seizures={data.seizures_today} />
              </div>
            </div>
          </>
        )}
      </AsyncSection>
    </PageLayout>
  );
}
