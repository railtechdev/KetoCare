import {
  AsyncSection,
  MacroBar,
  RatioBadge,
  Section,
  formatOccurredAt,
} from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import type { Session } from "../session/useSession";
import { type Overview, usePatientOverview } from "./useOverview";

/**
 * Главная-сводка (раздел 9 ТЗ).
 *
 * Один запрос на весь экран — тот же `/overview`, что питает главную кабинета:
 * разложить его на части значило бы показать четыре куска дня, снятых в четыре
 * разных момента, и на границе суток они относились бы к разным датам.
 *
 * Вердикта «день в допуске» здесь пока нет намеренно. То, что интерфейс говорит
 * о соответствии дня назначению, живёт одним куском в кабинете
 * (`features/patients/dayVerdict.ts`), и вторая копия этого правила — ровно тот
 * случай, когда два экрана начинают говорить о ребёнке разное. Когда вердикт
 * понадобится и здесь, он переезжает в общий пакет, а не копируется.
 */
export function HomeScreen({ session }: { session: Session }) {
  const { t } = useTranslation();
  // Общий хук, а не своя копия запроса: хук ровно об этом и предупреждает —
  // две копии делят кэш, но расходятся в обработке (находка М7 аудита).
  const overview = usePatientOverview(session.patientId);

  return (
    <main className="flex flex-col gap-block p-block">
      <header>
        <h1 className="text-page-title">{session.patientName}</h1>
      </header>

      <AsyncSection
        loading={overview.isPending}
        skeleton={null}
        error={
          overview.isError
            ? {
                title: t("home.loadError"),
                description:
                  errorMessageOf(overview.error) ?? t("home.loadErrorHint"),
              }
            : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void overview.refetch()}
        isEmpty={false}
        empty={null}
      >
        {overview.data !== undefined && <Summary overview={overview.data} />}
      </AsyncSection>
    </main>
  );
}

function Summary({ overview }: { overview: Overview }) {
  const { t } = useTranslation();
  const {
    prescription,
    day,
    last_ketone: ketone,
    last_weight: weight,
  } = overview;

  return (
    <div className="flex flex-col gap-block">
      <Section title={t("home.prescription.title")} density="compact">
        {prescription === null || prescription === undefined ? (
          <p className="text-muted-foreground">{t("home.prescription.none")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-field">
            <RatioBadge ratio={Number(prescription.ratio)} />
            <span>
              {t("home.prescription.kcal", { kcal: prescription.kcal_per_day })}
            </span>
            <span className="text-muted-foreground">
              {t("home.prescription.macros", {
                protein: prescription.protein_g,
                carbs: prescription.carbs_limit_g,
              })}
            </span>
          </div>
        )}
      </Section>

      <Section title={t("home.today.title")} density="compact">
        {day === null || day === undefined ? (
          <p className="text-muted-foreground">{t("home.today.noMenu")}</p>
        ) : (
          <MacroBar
            fatG={day.totals.fat}
            proteinG={day.totals.protein}
            carbsG={day.totals.carbs}
            showGrams
          />
        )}
      </Section>

      <Section title={t("home.readings.title")} density="compact">
        <dl className="grid grid-cols-2 gap-field">
          <Reading
            label={t("home.readings.ketones")}
            value={ketone ? String(ketone.value) : null}
            at={ketone?.occurred_at}
            empty={t("home.readings.none")}
          />
          <Reading
            label={t("home.readings.weight")}
            value={
              weight
                ? t("home.readings.weightValue", { value: weight.weight_kg })
                : null
            }
            at={weight?.occurred_at}
            empty={t("home.readings.none")}
          />
        </dl>
      </Section>
    </div>
  );
}

function Reading({
  label,
  value,
  at,
  empty,
}: {
  label: string;
  value: string | null;
  at: string | undefined;
  empty: string;
}) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        {value === null ? (
          <span className="text-muted-foreground">{empty}</span>
        ) : (
          <>
            {value}
            {at !== undefined && (
              <span className="text-muted-foreground">
                {" "}
                · {formatOccurredAt(new Date(at))}
              </span>
            )}
          </>
        )}
      </dd>
    </div>
  );
}
