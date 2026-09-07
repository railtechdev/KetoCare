import { AsyncSection, Columns } from "@ketocare/ui";
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
import { NewPrescriptionNotice } from "./NewPrescriptionNotice";
import { WaitingForPrescription } from "./WaitingForPrescription";
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
  const prescription = data?.prescription ?? null;

  return (
    // Ширина — `wide`, но плотность остаётся родительской: правило П26 канона
    // про количество дел на экране, а не про ширину. Дел на главной столько же,
    // просто «что делать сегодня» и «с чем это сверять» стоят рядом, а не одно
    // под другим.
    <PageLayout
      title={t("title")}
      width="wide"
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
            {/* Первым блоком и только в этот период: пока назначения нет,
                остальная главная состоит из пустых карточек, и подсказка о
                том, чего ждём и что уже можно делать, важнее их всех. */}
            {prescription === null ? (
              <WaitingForPrescription />
            ) : (
              <NewPrescriptionNotice
                patientId={patientId}
                prescription={prescription}
              />
            )}

            <QuickActions />

            {/* Слева то, что делают сегодня, справа — то, с чем это сверяют.
                Приставная колонка не уезжает при прокрутке: назначение — это
                справка, к которой обращаются, глядя на итоги дня, и уводить её
                вверх значило бы заставлять прокручивать туда-обратно.

                Раскладка та же, что была вручную (`lg:grid-cols-3` +
                `lg:col-span-2`), но теперь её задаёт общий примитив: колонки
                разошлись в шести экранах из тридцати, и каждый решал ширину
                приставной колонки заново. */}
            <Columns
              asideLabel={t("aside.label")}
              asideSticky
              main={
                <>
                  <NextMealCard patientId={patientId} />
                  <DayTotalsCard
                    day={data.day ?? null}
                    targetKcal={data.prescription?.kcal_per_day ?? null}
                  />
                  <LatestReadings
                    ketone={data.last_ketone ?? null}
                    weight={data.last_weight ?? null}
                  />
                </>
              }
              aside={
                <>
                  <PrescriptionCard prescription={data.prescription ?? null} />
                  <SeizuresCard seizures={data.seizures_today} />
                </>
              }
            />
          </>
        )}
      </AsyncSection>
    </PageLayout>
  );
}
