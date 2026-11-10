import {
  AsyncSection,
  Button,
  ConfirmDialog,
  RatioBadge,
  Section,
  cn,
  formatFactor,
  formatKcal,
  formatMass,
  toast,
} from "@ketocare/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { PrintButton } from "../../components/PrintButton";
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
import { useMealsPerDay } from "./useMenu";
import { useCopyWeek, useWeekQuery, type MenuWeek } from "./useWeek";

/**
 * Неделя ребёнка: дни по столбцам, приёмы по строкам.
 *
 * Выбранный день живёт в адресе и общий с `DayComposer` под сеткой: нажатие на
 * день открывает его сборку, а неделя всегда та, в которой этот день.
 */
export function WeekGrid({ patientId }: { patientId: string }) {
  const { t } = useTranslation("menu");
  const address = useAddressState();
  const patchAddress = useAddressPatch();
  const selected = address.date ?? todayIso();
  const start = weekStartOf(selected);

  const week = useWeekQuery(patientId, start);
  const copy = useCopyWeek(patientId);
  const mealsPerDay = useMealsPerDay(patientId) ?? 0;
  const patient = usePatient(patientId);

  const select = (date: string) =>
    patchAddress({ date: date === todayIso() ? undefined : date });

  const plannedMeals = (week.data?.days ?? []).flatMap((day) =>
    (day.menu?.items ?? []).map((item) => item.meal_index),
  );
  const mealCount = Math.max(mealsPerDay, 0, ...plannedMeals);
  const meals = Array.from({ length: mealCount }, (_, index) => index + 1);
  const hasPlan = plannedMeals.length > 0;

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
            disabled={!hasPlan || week.data === undefined}
          >
            {week.data !== undefined && (
              <WeekPrint
                week={week.data}
                patientName={patient.data?.full_name ?? ""}
              />
            )}
          </PrintButton>
        </div>
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] table-fixed border-collapse text-sm">
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
                      onClick={() => select(day.date)}
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
                          <p key={item.id} className="m-0">
                            {item.title ?? t("week.untitled")}
                            {item.portion_factor !== 1 && (
                              <span className="text-muted-foreground">
                                {" "}
                                {formatFactor(item.portion_factor)}
                              </span>
                            )}
                          </p>
                        ))}
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

function WeekPrint({
  week,
  patientName,
}: {
  week: MenuWeek;
  patientName: string;
}) {
  const { t } = useTranslation("menu");

  return (
    <div className="flex flex-col gap-4 text-sm">
      <h1 className="m-0 text-lg font-semibold">
        {t("week.printTitle", { name: patientName })}
      </h1>
      {week.days
        .filter((day) => (day.menu?.items ?? []).length > 0)
        .map((day) => (
          <section key={day.date} className="break-inside-avoid">
            <h2 className="m-0 font-semibold">{formatDayLabel(day.date)}</h2>
            {day.menu?.totals != null && (
              <p className="m-0">
                {t("week.printTotals", {
                  kcal: formatKcal(day.menu.totals.kcal),
                })}
              </p>
            )}
            {(day.menu?.items ?? []).map((item) => (
              <div key={item.id} className="mt-1">
                <p className="m-0 font-medium">
                  {t("week.mealNumber", { number: item.meal_index })}:{" "}
                  {item.title ?? t("week.untitled")}
                </p>
                <ul className="m-0 list-none p-0">
                  {(item.ingredients ?? []).map((row) => (
                    <li key={row.product_id}>
                      {row.name_ru} —{" "}
                      {t("week.grams", { value: formatMass(row.grams) })}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
    </div>
  );
}
