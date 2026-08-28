import { WarningBanner } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { usePatients } from "../patients/usePatients";
import { DayTotalsCard } from "./DayTotalsCard";
import { LatestReadings } from "./LatestReadings";
import { PrescriptionCard } from "./PrescriptionCard";
import { QuickActions } from "./QuickActions";
import { SeizuresCard } from "./SeizuresCard";
import { formatOverviewDate } from "./date";
import { usePatientOverview } from "../patients/overview";

/**
 * Главная родителя (раздел 8.3 ТЗ).
 *
 * Все данные экрана приходят одним запросом `/patients/{id}/overview`. Список
 * пациентов — не данные экрана, а общий кэшированный запрос (`['patients']`),
 * которым определяется, чей это кабинет: адреса сводки без идентификатора
 * ребёнка не существует.
 */
export function HomePage({ patientId }: { patientId: string }) {
  const { t } = useTranslation("home");

  const patients = usePatients();
  const overview = usePatientOverview(patientId);

  const loading =
    patients.isPending || (patientId !== null && overview.isPending);
  const failure = patients.error ?? overview.error;
  const data = overview.data ?? null;
  const dateLabel = data === null ? null : formatOverviewDate(data.date);

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t("title")}</h1>
        {dateLabel !== null && (
          <p className="m-0 mt-1 text-muted">
            {t("date", { date: dateLabel })}
          </p>
        )}
      </header>

      <QuickActions />

      {loading && (
        <p role="status" className="m-0 text-muted">
          {t("loading")}
        </p>
      )}

      {failure !== null && (
        <FormError>
          {errorMessageOf(failure) ?? t("common:errors.unexpected")}
        </FormError>
      )}

      {/* Ребёнок не определён — не ошибка: у учётной записи может не быть
          привязанного пациента, и семье нужно понятное объяснение, а не пустой
          экран. */}
      {!loading && failure === null && patientId === null && (
        <WarningBanner level="info" title={t("noPatient.title")}>
          {t("noPatient.body")}
        </WarningBanner>
      )}

      {data !== null && (
        <>
          <PrescriptionCard prescription={data.prescription ?? null} />
          <DayTotalsCard
            day={data.day ?? null}
            targetKcal={data.prescription?.kcal_per_day ?? null}
          />
          <LatestReadings
            ketone={data.last_ketone ?? null}
            weight={data.last_weight ?? null}
          />
          <SeizuresCard seizures={data.seizures_today} />
        </>
      )}
    </section>
  );
}
