import {
  AsyncSection,
  Button,
  Section,
  WarningBanner,
  formatDayMonth,
  formatGrams,
  formatKcal,
  formatLocale,
  formatMeasured,
  formatNumber,
  formatOccurredAt,
  formatRatio,
  formatWeight,
  parseDateInput,
} from "@ketocare/ui";
import { Droplet, Scale, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import type { ScreenRequest } from "../../lib/tabs";
import { AddEntry } from "../diary/AddEntry";
import type { CreatableKind } from "../diary/useDiary";
import { type Overview, usePatientOverview } from "../home/useOverview";
import { DayTotals } from "../menu/DayTotals";
import { mealNumbers, nextMeal } from "../menu/dayPlan";
import { MealItem } from "../menu/MealItem";
import { MenuScreen } from "../menu/MenuScreen";
import { dayAt, isPlanChanged, useMarkEaten, useMenu } from "../menu/useMenu";
import type { Session } from "../session/useSession";

/** Что открыто во вкладке: сводка дня или меню. */
type View = { at: "summary" } | { at: "menu"; dayOffset: number };

export interface TodayRequest {
  view?: "menu";
  dayOffset?: number;
}

/**
 * «Сегодня» — что с ребёнком сейчас и что сделать (ADR-0075).
 *
 * Прежде главная была сводкой с тремя блоками настроек под ней, и ни одного
 * действия на первом экране. Теперь на одном экране: назначение одной строкой,
 * быстрые записи («Приступ», «Кетоны», «Вес» — сразу форма, без выбора вида),
 * ближайший приём с отметками «съедено» и итоги дня одним блоком. Настройки
 * ушли на свой экран (шестерёнка в шапке и пункт меню Telegram).
 *
 * Меню дня — экраном внутри этой же вкладки («Открыть меню»): это тот же
 * сегодняшний день, подробнее.
 */
export function TodayScreen({
  session,
  request = null,
}: {
  session: Session;
  request?: ScreenRequest<TodayRequest> | null;
}) {
  const [view, setView] = useState<View>(() =>
    request?.target.view === "menu"
      ? { at: "menu", dayOffset: request.target.dayOffset ?? 0 }
      : { at: "summary" },
  );
  const [handled, setHandled] = useState(request?.id ?? null);

  // Новый запрос к уже открытой вкладке: «Открыть меню» после добавления
  // блюда из рецепта, кнопка под напоминанием бота.
  useEffect(() => {
    if (request === null || request.id === handled) return;
    setHandled(request.id);
    setView(
      request.target.view === "menu"
        ? { at: "menu", dayOffset: request.target.dayOffset ?? 0 }
        : { at: "summary" },
    );
  }, [request, handled]);

  if (view.at === "menu") {
    return (
      <MenuScreen
        // Другой день из запроса — меню открывается на нём заново.
        key={`${handled ?? "own"}:${view.dayOffset}`}
        session={session}
        initialDayOffset={view.dayOffset}
        onBack={() => {
          setView({ at: "summary" });
          window.scrollTo(0, 0);
        }}
      />
    );
  }
  return (
    <TodaySummary
      session={session}
      onOpenMenu={() => {
        setView({ at: "menu", dayOffset: 0 });
        window.scrollTo(0, 0);
      }}
    />
  );
}

/** Быстрые записи: то, что записывают срочно и чаще всего. */
const QUICK: readonly { kind: CreatableKind; icon: LucideIcon }[] = [
  { kind: "seizures", icon: Zap },
  { kind: "ketones", icon: Droplet },
  { kind: "weight", icon: Scale },
];

function TodaySummary({
  session,
  onOpenMenu,
}: {
  session: Session;
  onOpenMenu: () => void;
}) {
  const { t } = useTranslation();
  // Один запрос на сводку — тот же `/overview`, что питает главную кабинета:
  // разложить его на части значило бы показать куски дня, снятые в разные
  // моменты.
  const overview = usePatientOverview(session.patientId);
  const [quick, setQuick] = useState<CreatableKind | null>(null);

  return (
    <main className="flex flex-col gap-section p-section">
      <h1 className="text-page-title">{t("today.title")}</h1>

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
        {overview.data !== undefined && (
          <div className="flex flex-col gap-section">
            <Notices overview={overview.data} />
            <PrescriptionLine overview={overview.data} />
            <QuickRecords overview={overview.data} onPick={setQuick} />
            <NextMealBlock
              session={session}
              overview={overview.data}
              onOpenMenu={onOpenMenu}
            />
            {overview.data.day != null && (
              <DayTotals
                totals={overview.data.day.totals}
                targets={
                  overview.data.prescription == null
                    ? null
                    : {
                        kcalPerDay: overview.data.prescription.kcal_per_day,
                        carbsLimitG: overview.data.prescription.carbs_limit_g,
                      }
                }
                verdict={{
                  otherDay: false,
                  tolerance: overview.data.day.tolerance ?? null,
                  gap: overview.data.day.tolerance_gap ?? null,
                }}
              />
            )}
          </div>
        )}
      </AsyncSection>

      {quick !== null && (
        <AddEntry
          key={quick}
          session={session}
          initialKind={quick}
          onClose={() => setQuick(null)}
        />
      )}
    </main>
  );
}

/** Завершённая терапия и вчерашний недобор — только когда они есть. */
function Notices({ overview }: { overview: Overview }) {
  const { t } = useTranslation();
  return (
    <>
      {/* Терапия завершена (вопрос 18, ADR-0050) — нейтрально и без причины:
          её семье называет врач. */}
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
          (`yesterday_shortfall`); нет поля — сказать нечего. */}
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
    </>
  );
}

type PrescriptionData = NonNullable<Overview["prescription"]>;

/** Показатели назначения через «·»: соотношение, калорийность, белок, углеводы. */
function usePrescriptionParts() {
  const { t } = useTranslation();
  return (prescription: PrescriptionData) => [
    t("today.prescription.ratio", {
      value: formatRatio(Number(prescription.ratio)),
    }),
    t("home.prescription.kcal", {
      kcal: formatKcal(prescription.kcal_per_day),
    }),
    t("home.prescription.macros", {
      protein: formatGrams(prescription.protein_g),
      carbs: formatGrams(prescription.carbs_limit_g),
    }),
    // Жидкость врач задаёт не всегда (ADR-0069).
    ...(prescription.fluid_ml_per_day != null
      ? [
          t("home.prescription.fluid", {
            value: formatNumber(prescription.fluid_ml_per_day, 0),
          }),
        ]
      : []),
  ];
}

/**
 * Назначение одной строкой — или одной строкой о том, что его нет.
 *
 * Версия, у которой «Действует с» позже сегодня, — отдельной строкой с датой:
 * день по ней ещё не судится, и семья должна видеть, с какого числа менять
 * меню (правило действующего назначения, аудит расчётов 13.11.2026).
 */
function PrescriptionLine({ overview }: { overview: Overview }) {
  const { t } = useTranslation();
  const parts = usePrescriptionParts();
  const prescription = overview.prescription;
  const upcoming = overview.upcoming_prescription ?? null;
  const startsOn =
    upcoming === null ? null : parseDateInput(upcoming.effective_from);
  const upcomingLine =
    upcoming === null || startsOn === null ? null : (
      <p className="m-0 text-sm tabular-nums">
        <span className="font-semibold">
          {t("home.prescription.upcoming", { date: formatDayMonth(startsOn) })}
          :{" "}
        </span>
        {parts(upcoming).join(" · ")}
      </p>
    );
  if (prescription == null) {
    return (
      upcomingLine ?? (
        <p className="m-0 text-muted-foreground">
          {t("home.prescription.none")}
        </p>
      )
    );
  }
  return (
    <>
      <p className="m-0 text-sm tabular-nums">
        <span className="font-semibold">{t("home.prescription.title")}: </span>
        {parts(prescription).join(" · ")}
      </p>
      {upcomingLine}
    </>
  );
}

/**
 * «Приступ», «Кетоны», «Вес» — сразу форма своего вида.
 *
 * Прежде запись приступа стоила 7–9 нажатий: вкладка, «Добавить запись»,
 * выбор вида, и курсор вставал на дату. Теперь — нажатие и значение: фокус
 * встаёт на поле значения (`data-autofocus` в `FormSheet` кита). Под кнопкой
 * — последний замер, чтобы было с чем сравнить.
 */
function QuickRecords({
  overview,
  onPick,
}: {
  overview: Overview;
  onPick: (kind: CreatableKind) => void;
}) {
  const { t } = useTranslation();
  const last: Partial<Record<CreatableKind, string>> = {};
  if (overview.last_ketone) {
    last.ketones = t("today.quick.lastKetones", {
      value: formatMeasured(overview.last_ketone.value),
      // Способ замера рядом с числом: у крови и мочи шкалы разные, и «1,8»
      // без него с порогом врача не сравнить.
      method: t(
        overview.last_ketone.method === "blood"
          ? "diary.entry.ketonesBlood"
          : "diary.entry.ketonesUrine",
      ),
      when: formatOccurredAt(new Date(overview.last_ketone.occurred_at)),
    });
  }
  if (overview.last_weight) {
    last.weight = t("today.quick.lastWeight", {
      value: formatWeight(overview.last_weight.weight_kg),
      when: formatOccurredAt(new Date(overview.last_weight.occurred_at)),
    });
  }

  return (
    <section aria-labelledby="quick-records" className="flex flex-col gap-1">
      <h2 id="quick-records" className="m-0 text-card-title">
        {t("today.quick.title")}
      </h2>
      <ul className="m-0 grid list-none grid-cols-3 gap-field p-0">
        {QUICK.map(({ kind, icon: Icon }) => (
          <li key={kind} className="flex">
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-touch w-full flex-col gap-1 px-1 py-2 whitespace-normal"
              aria-describedby={
                last[kind] !== undefined ? `quick-last-${kind}` : undefined
              }
              onClick={() => onPick(kind)}
            >
              <Icon aria-hidden="true" className="size-5" />
              {t(`diary.add.kinds.${kind}`)}
            </Button>
          </li>
        ))}
      </ul>
      {(last.ketones !== undefined || last.weight !== undefined) && (
        <p className="m-0 flex flex-col text-xs text-muted-foreground tabular-nums">
          {last.ketones !== undefined && (
            <span id="quick-last-ketones">{last.ketones}</span>
          )}
          {last.weight !== undefined && (
            <span id="quick-last-weight">{last.weight}</span>
          )}
        </p>
      )}
    </section>
  );
}

/**
 * Ближайший приём с отметками «съедено» — отмечать отсюда, не открывая меню.
 *
 * Пустое меню — кнопка «Составить меню», если есть назначение; без назначения
 * — строка: приёмы задаёт врач, и предлагать собрать день не из чего.
 */
function NextMealBlock({
  session,
  overview,
  onOpenMenu,
}: {
  session: Session;
  overview: Overview;
  onOpenMenu: () => void;
}) {
  const { t } = useTranslation();
  const day = dayAt(0);
  const menu = useMenu(session.patientId, day);
  const mark = useMarkEaten(session.patientId, day);
  const meals = mealNumbers(overview.prescription?.meals_per_day ?? null);
  const items = menu.data?.items ?? [];
  const next = nextMeal(items);

  return (
    <Section title={t("today.menu.title")} density="compact">
      <AsyncSection
        loading={menu.isPending}
        skeleton={null}
        error={
          menu.isError
            ? {
                title: t("menu.loadError"),
                description:
                  errorMessageOf(menu.error) ?? t("home.loadErrorHint"),
              }
            : null
        }
        waiting={
          menu.fetchStatus === "paused" ? t("errors.waitingForNetwork") : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void menu.refetch()}
        isEmpty={next === null}
        empty={
          meals.length > 0 ? (
            <div className="flex flex-col gap-field">
              <p className="m-0 text-muted-foreground">
                {t("home.today.noMenu")}
              </p>
              <Button
                type="button"
                className="min-h-touch w-full"
                onClick={onOpenMenu}
              >
                {t("menu.compose.open")}
              </Button>
            </div>
          ) : (
            <p className="m-0 text-muted-foreground">
              {t("menu.compose.noPrescription")}
            </p>
          )
        }
      >
        {next !== null && (
          <div className="flex flex-col gap-field">
            {next.kind === "allEaten" ? (
              <p role="status" className="m-0 text-success">
                {t("today.menu.allEaten")}
              </p>
            ) : (
              <>
                <h3 className="m-0 text-card-title">
                  {t("today.menu.next", { index: next.mealIndex })}
                </h3>
                <ul className="m-0 flex list-none flex-col gap-field p-0">
                  {next.items.map((item) => (
                    <li key={item.id}>
                      <MealItem
                        item={item}
                        canMarkEaten
                        pending={
                          mark.isPending && mark.variables?.itemId === item.id
                        }
                        failed={
                          mark.isError &&
                          !isPlanChanged(mark.error) &&
                          mark.variables?.itemId === item.id
                        }
                        failure={
                          errorMessageOf(mark.error) ?? t("menu.markFailedHint")
                        }
                        onToggle={(target) =>
                          mark.mutate({
                            itemId: target.id,
                            eaten: !target.eaten,
                          })
                        }
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Button
              type="button"
              variant="outline"
              className="min-h-touch w-full"
              onClick={onOpenMenu}
            >
              {t("today.menu.open")}
            </Button>
          </div>
        )}
      </AsyncSection>
    </Section>
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
