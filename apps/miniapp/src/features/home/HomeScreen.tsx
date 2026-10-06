import {
  formatGrams,
  formatKcal,
  AsyncSection,
  MacroBar,
  RatioBadge,
  Section,
  WarningBanner,
  formatOccurredAt,
  formatMeasured,
  formatWeight,
  formatLocale,
} from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { FamilyBlock } from "../family/FamilyBlock";
import { DayVerdictNote } from "../menu/DayVerdictNote";
import { RemindersBlock } from "../reminders/RemindersBlock";
import { LanguageSwitch } from "../session/LanguageSwitch";
import { WebAccessPanel } from "../session/WebAccessPanel";
import type { Session } from "../session/useSession";
import { type Overview, usePatientOverview } from "./useOverview";

/**
 * Главная-сводка (раздел 9 ТЗ).
 *
 * Один запрос на весь экран — тот же `/overview`, что питает главную кабинета:
 * разложить его на части значило бы показать четыре куска дня, снятых в четыре
 * разных момента, и на границе суток они относились бы к разным датам.
 *
 * Вердикт «день в допуске» стоит под итогами дня с 05.10.2026: правило переехало
 * из кабинета в кит (`dayVerdict`), а не скопировано, — два экрана, говорящие о
 * ребёнке по-разному, хуже экрана, который молчит. Сводка всегда за сегодня, и
 * вердикт в ней относится к тому же дню.
 */
export function HomeScreen({ session }: { session: Session }) {
  const { t } = useTranslation();
  // Общий хук, а не своя копия запроса: хук ровно об этом и предупреждает —
  // две копии делят кэш, но расходятся в обработке (находка М7 аудита).
  const overview = usePatientOverview(session.patientId);

  return (
    <main className="flex flex-col gap-block p-block">
      <header className="flex flex-wrap items-center justify-between gap-field">
        {/* Имя ребёнка без пробелов не должно распирать экран телефона. */}
        <h1 className="min-w-0 break-words text-page-title">
          {session.patientName}
        </h1>
        {/* Язык — на первом экране, а не в настройках: его ищет тот, кто не
            читает языка, на котором приложение открылось (ADR-0052). */}
        <LanguageSwitch persist />
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
        waiting={
          overview.fetchStatus === "paused"
            ? t("errors.waitingForNetwork")
            : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void overview.refetch()}
        isEmpty={false}
        empty={null}
      >
        {overview.data !== undefined && <Summary overview={overview.data} />}
      </AsyncSection>

      {/* Ниже сводки: разовые дела не должны стоять над ежедневным.
          Напоминания — первыми из них: они и есть распорядок дня, их сдвигают
          и выключают (неделя в больнице), а близких зовут однажды. Близкие —
          выше кабинета: позвать бабушку нужно чаще, чем открыть компьютер. */}
      <RemindersBlock session={session} />
      <FamilyBlock session={session} />
      <WebAccessPanel session={session} />
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
      {/* Терапия завершена (вопрос 18, ADR-0050) — нейтрально и без причины:
          её семье называет врач. Тот же текст, что в кабинете. */}
      {(overview.therapy_ended_on ?? null) !== null && (
        <Section title={t("home.therapyEnded.title")} density="compact">
          <p className="m-0">
            {t("home.therapyEnded.text", {
              date: formatIsoDay(overview.therapy_ended_on ?? ""),
            })}
          </p>
        </Section>
      )}
      {/* Вчерашний недобор — ответ клиники на вопрос 9. Решает сервер
          (`yesterday_shortfall`): что съедено, какая норма действовала вчера и
          вышел ли недобор за допуск ядра. Нет поля — сказать нечего. Тот же
          текст, что в кабинете. */}
      {(overview.yesterday_shortfall ?? null) !== null && (
        <WarningBanner
          level="warning"
          title={t("home.yesterdayShortfall.title")}
        >
          {t("home.yesterdayShortfall.text", {
            value: formatKcal(
              overview.yesterday_shortfall?.shortfall_kcal ?? 0,
            ),
          })}
        </WarningBanner>
      )}
      <Section title={t("home.prescription.title")} density="compact">
        {prescription === null || prescription === undefined ? (
          <p className="text-muted-foreground">{t("home.prescription.none")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-field">
            <RatioBadge ratio={Number(prescription.ratio)} />
            <span>
              {t("home.prescription.kcal", {
                kcal: formatKcal(prescription.kcal_per_day),
              })}
            </span>
            <span className="text-muted-foreground">
              {t("home.prescription.macros", {
                protein: formatGrams(prescription.protein_g),
                carbs: formatGrams(prescription.carbs_limit_g),
              })}
            </span>
          </div>
        )}
      </Section>

      <Section title={t("home.today.title")} density="compact">
        {day === null || day === undefined ? (
          <p className="text-muted-foreground">{t("home.today.noMenu")}</p>
        ) : (
          <>
            <MacroBar
              fatG={day.totals.fat}
              proteinG={day.totals.protein}
              carbsG={day.totals.carbs}
              showGrams
            />
            <DayVerdictNote
              tolerance={day.tolerance}
              gap={day.tolerance_gap}
              kcal={day.totals.kcal}
              targetKcal={prescription?.kcal_per_day ?? null}
            />
          </>
        )}
      </Section>

      <Section title={t("home.readings.title")} density="compact">
        <dl className="grid grid-cols-2 gap-field">
          <Reading
            label={t("home.readings.ketones")}
            value={ketone ? formatMeasured(ketone.value) : null}
            at={ketone?.occurred_at}
            empty={t("home.readings.none")}
          />
          <Reading
            label={t("home.readings.weight")}
            value={
              weight
                ? t("home.readings.weightValue", {
                    value: formatWeight(weight.weight_kg),
                  })
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

/**
 * «28 августа 2026 г.» из `YYYY-MM-DD` — по частям, а не через `new Date(…)`:
 * такая строка читается как полночь UTC и западнее Гринвича съезжает на день.
 */
function formatIsoDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return value;
  return new Intl.DateTimeFormat(formatLocale(), {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}
