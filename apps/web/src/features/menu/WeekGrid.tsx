import {
  ActionReason,
  AsyncSection,
  Button,
  ConfirmDialog,
  RatioBadge,
  Section,
  cn,
  formatGrams,
  formatKcal,
  formatRatio,
  toast,
} from "@ketocare/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { PrintButton } from "../../components/PrintButton";
import { PrintedDish } from "../../components/PrintedDish";
import { errorMessageOf } from "../../lib/api";
import { queryState } from "../../lib/queryState";
import { useAddressPatch, useAddressState } from "../../routes/useSectionTab";
import { usePatient } from "../patients/usePatient";
import {
  formatDayLabel,
  formatWeekday,
  shiftIsoDate,
  todayIso,
  weekStartOf,
} from "./dates";
import { DEFAULT_MEAL_COUNT, useMealsPerDay } from "./useMenu";
import { WeekCellAdd } from "./WeekCellAdd";
import { WeekCellItem } from "./WeekCellItem";
import { useCopyWeek, useWeekQuery, type MenuWeek } from "./useWeek";

/**
 * Неделя ребёнка: дни по столбцам, приёмы по строкам.
 *
 * Выбранный день живёт в адресе и общий с `DayComposer` под сеткой: нажатие на
 * день открывает его сборку, а неделя всегда та, в которой этот день.
 */
export function WeekGrid({
  patientId,
  dayAnchorId,
}: {
  patientId: string;
  /** Блок сборки дня под сеткой: нажатие на день открывает его и ведёт к нему. */
  dayAnchorId?: string;
}) {
  const { t } = useTranslation("menu");
  const address = useAddressState();
  const patchAddress = useAddressPatch();
  const selected = address.date ?? todayIso();
  const start = weekStartOf(selected);

  const week = useWeekQuery(patientId, start);
  const copy = useCopyWeek(patientId);
  // Без назначения — то же число приёмов, что у сборки дня под сеткой:
  // иначе сетка пустела и ставить блюдо было некуда.
  const mealsPerDay = useMealsPerDay(patientId) ?? DEFAULT_MEAL_COUNT;
  const patient = usePatient(patientId);

  const select = (date: string) =>
    patchAddress({ date: date === todayIso() ? undefined : date });
  const openDay = (date: string) => {
    select(date);
    if (dayAnchorId === undefined) return;
    requestAnimationFrame(() =>
      document
        .getElementById(dayAnchorId)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  const plannedMeals = (week.data?.days ?? []).flatMap((day) =>
    (day.menu?.items ?? []).map((item) => item.meal_index),
  );
  const mealCount = Math.max(mealsPerDay, 0, ...plannedMeals);
  const meals = Array.from({ length: mealCount }, (_, index) => index + 1);
  const hasPlan = plannedMeals.length > 0;
  // Печать недели серела без слова (аудит, «Тупики»): причина — рядом.
  const printBlockedBy =
    week.data === undefined
      ? t("week.printWaiting")
      : hasPlan
        ? null
        : t("week.printEmpty");
  const printReasonId = useId();

  return (
    <Section title={t("week.title")} description={t("week.intro")}>
      <div className="flex flex-wrap items-center gap-field">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t("week.previous")}
          onClick={() => select(shiftIsoDate(selected, -7))}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span className="tabular-nums">
          {t("week.range", {
            from: formatDayLabel(start),
            to: formatDayLabel(shiftIsoDate(start, 6)),
          })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t("week.next")}
          onClick={() => select(shiftIsoDate(selected, 7))}
        >
          <ChevronRight aria-hidden="true" />
        </Button>

        <div className="flex flex-wrap gap-field sm:ml-auto">
          <ConfirmDialog
            trigger={
              <Button type="button" variant="outline" disabled={copy.isPending}>
                {t("week.copyPrevious")}
              </Button>
            }
            title={t("week.copyTitle")}
            description={t("week.copyDescription")}
            confirmLabel={t("week.copyConfirm")}
            cancelLabel={t("common:actions.cancel")}
            onConfirm={() => {
              copy.mutate(
                { sourceStart: shiftIsoDate(start, -7), targetStart: start },
                {
                  onSuccess: (result) =>
                    toast.success(
                      t("week.copied", { count: result.copied.length }),
                      result.skipped.length > 0
                        ? {
                            description: t("week.copySkipped", {
                              count: result.skipped.length,
                            }),
                          }
                        : undefined,
                    ),
                  onError: (error) =>
                    toast.error(
                      errorMessageOf(error) ?? t("common:errors.unexpected"),
                    ),
                },
              );
            }}
          />
          <PrintButton
            label={t("week.print")}
            disabled={printBlockedBy !== null}
            describedBy={printBlockedBy === null ? undefined : printReasonId}
          >
            {week.data !== undefined && (
              <WeekPrint
                week={week.data}
                patientName={patient.data?.full_name ?? ""}
              />
            )}
          </PrintButton>
        </div>
        <ActionReason id={printReasonId} className="w-full sm:text-right">
          {printBlockedBy}
        </ActionReason>
      </div>

      <AsyncSection
        {...queryState(week)}
        skeleton={null}
        error={
          week.isError
            ? {
                title: t("week.errorTitle"),
                description:
                  errorMessageOf(week.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void week.refetch()}
        isEmpty={false}
        empty={null}
      >
        {/* 52rem — меньше всего, при котором «+ Добавить» встаёт в день одной
            строкой. При 56rem неделя в карте пациента на ноутбуке 1280 px
            уходила в прокрутку из-за последних девяти пикселей воскресенья. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] table-fixed border-collapse text-sm">
            <caption className="sr-only">{t("week.title")}</caption>
            <thead>
              <tr>
                <th scope="col" className="w-20 p-1">
                  <span className="sr-only">{t("week.meal")}</span>
                </th>
                {(week.data?.days ?? []).map((day) => (
                  <th key={day.date} scope="col" className="p-1 font-normal">
                    <Button
                      type="button"
                      variant={day.date === selected ? "secondary" : "ghost"}
                      className="w-full"
                      aria-pressed={day.date === selected}
                      aria-label={t("week.openDay", {
                        date: formatDayLabel(day.date),
                      })}
                      onClick={() => openDay(day.date)}
                    >
                      {formatWeekday(day.date)}
                    </Button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {meals.map((meal) => (
                <tr key={meal} className="border-t border-border/60">
                  <th
                    scope="row"
                    className="p-1 text-left align-top font-normal text-muted-foreground"
                  >
                    {t("week.mealNumber", { number: meal })}
                  </th>
                  {(week.data?.days ?? []).map((day) => (
                    <td
                      key={day.date}
                      className={cn(
                        "p-1 align-top break-words",
                        day.date === selected && "bg-muted/40",
                      )}
                    >
                      {(day.menu?.items ?? [])
                        .filter((item) => item.meal_index === meal)
                        .map((item) => (
                          <WeekCellItem
                            key={item.id}
                            patientId={patientId}
                            date={day.date}
                            dayLabel={formatDayLabel(day.date)}
                            item={item}
                            dayItems={day.menu?.items ?? []}
                          />
                        ))}
                      <WeekCellAdd
                        patientId={patientId}
                        date={day.date}
                        mealIndex={meal}
                        dayLabel={formatDayLabel(day.date)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-border">
                <th
                  scope="row"
                  className="p-1 text-left align-top font-normal text-muted-foreground"
                >
                  {t("week.totals")}
                </th>
                {(week.data?.days ?? []).map((day) => (
                  <td key={day.date} className="p-1 align-top">
                    {day.menu?.totals != null && (
                      <div className="flex flex-col items-start gap-1 tabular-nums">
                        <RatioBadge ratio={day.menu.totals.ratio} />
                        <span>
                          {t("week.kcal", {
                            value: formatKcal(day.menu.totals.kcal),
                          })}
                        </span>
                        <DayMacroTotals
                          protein={day.menu.totals.protein}
                          carbs={day.menu.totals.carbs}
                          prescription={day.menu.prescription ?? null}
                        />
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </AsyncSection>
    </Section>
  );
}

/**
 * Белок и углеводы дня рядом с назначением — в «Итого» недели.
 *
 * Диетолог 17.11.2026 боялась, что дети в первый день «не добрали» белок, а
 * неделя показывала только соотношение и калории: белок дня было видно, лишь
 * открыв день. Белок назначения — минимум (ADR-0087), сверх него не
 * подсвечивается; углеводы — предел. Сравнение до десятой, как печатает
 * `formatGrams`: 22,96 из 23 — набрано. Вердикта нет — его выносит сервер.
 */
function DayMacroTotals({
  protein,
  carbs,
  prescription,
}: {
  protein: number;
  carbs: number;
  prescription: { protein_g: number; carbs_limit_g: number } | null;
}) {
  const { t } = useTranslation("menu");

  if (prescription === null) {
    return (
      <span className="text-muted-foreground">
        {t("week.macros", {
          protein: formatGrams(protein),
          carbs: formatGrams(carbs),
        })}
      </span>
    );
  }

  const proteinShort = Math.round((prescription.protein_g - protein) * 10) > 0;
  const carbsOver = Math.round((carbs - prescription.carbs_limit_g) * 10) > 0;

  return (
    <>
      <span className={cn(proteinShort && "font-medium text-warning-strong")}>
        <span aria-hidden="true">
          {t("week.proteinShort", {
            value: formatGrams(protein),
            min: formatGrams(prescription.protein_g),
          })}
        </span>
        <span className="sr-only">
          {t(proteinShort ? "week.proteinBelow" : "week.proteinFull", {
            value: formatGrams(protein),
            min: formatGrams(prescription.protein_g),
          })}
        </span>
      </span>
      <span className={cn(carbsOver && "font-medium text-destructive")}>
        <span aria-hidden="true">
          {t("week.carbsShort", {
            value: formatGrams(carbs),
            limit: formatGrams(prescription.carbs_limit_g),
          })}
        </span>
        <span className="sr-only">
          {t(carbsOver ? "week.carbsAbove" : "week.carbsFull", {
            value: formatGrams(carbs),
            limit: formatGrams(prescription.carbs_limit_g),
          })}
        </span>
      </span>
    </>
  );
}

/**
 * The week on paper for a family or a cook (ADR-0088): a day per page, each
 * dish a block — the composition as a table, then how to cook it — and the
 * day's numbers under its date.
 */
export function WeekPrint({
  week,
  patientName,
}: {
  week: MenuWeek;
  patientName: string;
}) {
  const { t } = useTranslation("menu");

  return (
    <div className="flex flex-col gap-4 text-sm">
      {week.days
        .filter((day) => (day.menu?.items ?? []).length > 0)
        .map((day, index) => (
          <section
            key={day.date}
            className={cn(
              "flex flex-col gap-3",
              index > 0 && "break-before-page",
            )}
          >
            <header className="flex flex-col gap-0.5 border-b border-black pb-1">
              <p className="m-0 text-xs">
                {t("week.printTitle", { name: patientName })}
              </p>
              <h1 className="m-0 text-lg font-semibold">
                {formatDayLabel(day.date)}
              </h1>
              {day.menu?.totals != null && (
                <p className="m-0">
                  {day.menu.totals.ratio !== null && (
                    <>{formatRatio(day.menu.totals.ratio)} · </>
                  )}
                  {t("week.printTotals", {
                    kcal: formatKcal(day.menu.totals.kcal),
                  })}
                  {" · "}
                  {t("week.printMacros", {
                    fat: formatGrams(day.menu.totals.fat),
                    protein: formatGrams(day.menu.totals.protein),
                    carbs: formatGrams(day.menu.totals.carbs),
                  })}
                </p>
              )}
            </header>
            {(day.menu?.excluded_products ?? []).length > 0 && (
              <p className="m-0 font-semibold">
                {t("week.printExcluded", {
                  names: (day.menu?.excluded_products ?? [])
                    .map((product) => product.name_ru)
                    .join(", "),
                })}
              </p>
            )}
            {[...(day.menu?.items ?? [])]
              .sort((a, b) => a.meal_index - b.meal_index)
              .map((item) => (
                <PrintedDish
                  key={item.id}
                  level={2}
                  heading={t("week.printDish", {
                    number: item.meal_index,
                    title: item.title ?? t("week.untitled"),
                  })}
                  lines={(item.ingredients ?? []).map((row) => ({
                    key: row.product_id,
                    name: row.name_ru,
                    grams: row.grams,
                  }))}
                  steps={item.instructions}
                />
              ))}
          </section>
        ))}
    </div>
  );
}
