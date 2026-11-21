import {
  AsyncSection,
  Button,
  describeMedicationFrequency,
  formatLongDate,
  medicationTerm,
  parseDateInput,
  scheduledMedications,
  toDateInput,
  type MedicationTerm,
} from "@ketocare/ui";
import type { TFunction } from "i18next";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useTelegramBack } from "../../lib/useTelegram";
import type { Session } from "../session/useSession";
import { useMedicationScheme } from "../today/useMedicationsToday";

/**
 * «Схема препаратов» — на чтение (Р4 аудита Mini App 21.11.2026).
 *
 * У семьи из Telegram кабинета нет, и листа «Схема приёма препаратов» ей никто
 * не печатал. Здесь то же самое, что на листе: препарат, доза, кратность
 * словами и срок — теми же словами и по тому же правилу кита
 * (`medicationTerm`, `scheduledMedications`): «до … включительно», «с … до …
 * включительно», «с …», «принимается». Отменённые не показываются: схема — что
 * давать, а не история.
 *
 * Править здесь нечего и нельзя: схему меняет только врач. Открывается из блока
 * «Лекарства сегодня» («Вся схема») и из настроек.
 */
export function MedicationScheme({
  session,
  onBack,
  backLabel,
}: {
  session: Session;
  onBack: () => void;
  /** Куда ведёт «Назад»: «Сегодня» или «Настройки». */
  backLabel: string;
}) {
  const { t } = useTranslation();
  useTelegramBack(onBack);
  const today = toDateInput(new Date());
  const scheme = useMedicationScheme(session.patientId);
  const items = scheduledMedications(scheme.data ?? [], today);

  return (
    <main className="flex flex-col gap-section p-section">
      <Button
        variant="ghost"
        className="min-h-touch self-start"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden className="size-4" />
        {backLabel}
      </Button>
      <h1 className="text-page-title">{t("medicationScheme.title")}</h1>
      <p className="m-0 text-muted-foreground">{t("medicationScheme.hint")}</p>

      <AsyncSection
        loading={scheme.isPending}
        skeleton={null}
        error={
          scheme.isError
            ? {
                title: t("medicationScheme.loadError"),
                description:
                  errorMessageOf(scheme.error) ?? t("home.loadErrorHint"),
              }
            : null
        }
        waiting={
          scheme.fetchStatus === "paused" ? t("errors.waitingForNetwork") : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void scheme.refetch()}
        isEmpty={scheme.isSuccess && items.length === 0}
        empty={
          <p className="m-0 text-muted-foreground">
            {t("medicationScheme.empty")}
          </p>
        }
      >
        {items.length > 0 && (
          <ul className="m-0 flex list-none flex-col p-0">
            {items.map((medication) => {
              const frequency = describeMedicationFrequency(
                medication,
                (code) => t(`today.medications.frequency.${code}`),
              );
              return (
                <li
                  key={medication.id}
                  className="flex flex-col gap-1 border-b border-border py-field last:border-b-0"
                >
                  <p className="m-0">
                    <span className="font-medium">{medication.drug_name}</span>
                    {medication.dose !== "" && (
                      <span className="text-muted-foreground">
                        {" · "}
                        {medication.dose}
                      </span>
                    )}
                  </p>
                  {frequency !== "" && (
                    <p className="m-0 text-sm text-muted-foreground">
                      {frequency}
                    </p>
                  )}
                  <p className="m-0 text-sm">
                    {termWords(medicationTerm(medication, today), t)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </AsyncSection>

      {/* Те же слова, что на листе кабинета: доза — решение врача. */}
      <p className="m-0 text-sm font-medium">{t("medicationScheme.warning")}</p>
    </main>
  );
}

/** Срок словами словаря — какие слова, решил кит; даты — с названием месяца. */
function termWords(term: MedicationTerm, t: TFunction): string {
  switch (term.key) {
    case "ongoing":
      return t("medicationScheme.term.ongoing");
    case "until":
      return t("medicationScheme.term.until", { date: dayWords(term.date) });
    case "startsOn":
      return t("medicationScheme.term.startsOn", {
        date: dayWords(term.date),
      });
    case "startsUntil":
      return t("medicationScheme.term.startsUntil", {
        from: dayWords(term.from),
        to: dayWords(term.to),
      });
  }
}

/** «12 декабря»; другой год — с годом: «12 января 2027 г.». */
function dayWords(value: string): string {
  const date = parseDateInput(value);
  if (date === null) return value;
  return formatLongDate(date, {
    year: date.getFullYear() !== new Date().getFullYear(),
  });
}
