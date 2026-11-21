import {
  Button,
  FieldShell,
  NativeSelect,
  StatusNote,
  WarningBanner,
} from "@ketocare/ui";
import { type ReactNode, useContext, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { NavigateContext } from "../../lib/tabs";
import { DayStrip } from "./DayStrip";
import { itemsOf, mealNumbers, withDish } from "./dayPlan";
import { PLAN_DAYS, WEEK_START_OFFSET, dayName, menuDatesOf } from "./planDays";
import { dayAt, useDayPrescription, useMenu, useMenuWeek } from "./useMenu";
import { useSaveMenu } from "./useSaveMenu";

/**
 * «Добавить в меню» — блюдо ребёнка или рецепт в приём выбранного дня.
 *
 * Стоит под посчитанным в расчёте блюдом, в карточке рецепта и в списке блюд
 * ребёнка (ADR-0075: рецепт ↔ меню в обе стороны). Путь записи тот же, что у
 * сборки дня (`dayPlan.ts` + `useSaveMenu`), а не своя копия: день сохраняется
 * ЦЕЛИКОМ, и позиции, совпавшие по `(meal_index, recipe_id, custom_dish_id)`,
 * сохраняют отметки «съедено» только если уходят обратно без искажений.
 * Поэтому:
 *
 * - **кнопки нет, пока меню выбранного дня не загружено успешно.** `PUT` из
 *   незагруженного состояния означал бы «день теперь состоит только из этого
 *   блюда» — прежние позиции ушли бы вместе с отметками;
 * - новая позиция дописывается к уже стоящим (`withDish`), а не заменяет их;
 * - приёмов столько, сколько назначил врач (ADR-0029); без назначения их нет.
 *
 * Порция — 1: у блюда это всё блюдо, у рецепта — одна порция.
 */
export function AddToPlan({
  patientId,
  dish,
  afterAdded,
}: {
  patientId: string;
  dish: { kind: "recipe" | "custom"; id: string };
  /** Что ещё предложить после добавления, кроме «Открыть меню». */
  afterAdded?: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useContext(NavigateContext);
  // Дни — сегодня и пять вперёд (`PLAN_DAYS`), как у «Что купить»: вчерашнее
  // меню отсюда не собирают (Р3 аудита Mini App).
  const [dayOffset, setDayOffset] = useState<number>(0);
  const day = dayAt(dayOffset);
  const week = useMenuWeek(patientId, dayAt(WEEK_START_OFFSET));
  // Приёмы — по назначению выбранного дня: завтра может начаться новая версия
  // с другим числом приёмов (ADR-0078).
  const dayPrescription = useDayPrescription(patientId, day);
  const meals = mealNumbers(dayPrescription.data?.meals_per_day ?? null);
  const [mealIndex, setMealIndex] = useState<number | null>(null);
  const chosenMeal = mealIndex ?? meals[0] ?? null;

  const menu = useMenu(patientId, day);
  const save = useSaveMenu(patientId, day);
  // Какое добавление уже сделано: повторное нажатие поставило бы блюдо в тот же
  // приём второй раз. Другой день или приём — другое добавление.
  const [added, setAdded] = useState<string | null>(null);
  const choice = `${day}:${chosenMeal ?? ""}`;

  const planKnown = menu.isSuccess;
  const dayLabel = dayName(dayOffset, t);

  // Что зависит от назначения выбранного дня: приёмы и кнопка записи.
  let body: ReactNode;
  if (dayPrescription.isError) {
    body = (
      <WarningBanner
        level="danger"
        title={t("calculator.plan.prescriptionFailed")}
      >
        <div className="flex flex-col gap-field">
          <span>
            {errorMessageOf(dayPrescription.error) ?? t("home.loadErrorHint")}
          </span>
          <Button
            type="button"
            variant="outline"
            className="min-h-touch self-start"
            onClick={() => void dayPrescription.refetch()}
          >
            {t("actions.retry")}
          </Button>
        </div>
      </WarningBanner>
    );
  } else if (!dayPrescription.isSuccess) {
    body = (
      <StatusNote>
        {dayPrescription.fetchStatus === "paused"
          ? t("errors.waitingForNetwork")
          : t("calculator.plan.prescriptionUnknown")}
      </StatusNote>
    );
  } else if (meals.length === 0 || chosenMeal === null) {
    body = (
      <p className="m-0 text-sm text-muted-foreground">
        {t("calculator.plan.noPrescription")}
      </p>
    );
  } else {
    body = (
      <>
        <FieldShell label={t("calculator.plan.meal")}>
          {() => (
            <NativeSelect
              value={chosenMeal}
              onChange={(event) => {
                setMealIndex(Number(event.target.value));
                save.reset();
              }}
            >
              {meals.map((index) => (
                <option key={index} value={index}>
                  {t("menu.meal", { index })}
                </option>
              ))}
            </NativeSelect>
          )}
        </FieldShell>

        {menu.isError ? (
          <WarningBanner level="danger" title={t("calculator.plan.loadError")}>
            {errorMessageOf(menu.error) ?? t("home.loadErrorHint")}
          </WarningBanner>
        ) : !planKnown ? (
          <StatusNote>
            {menu.fetchStatus === "paused"
              ? t("errors.waitingForNetwork")
              : t("calculator.plan.loading")}
          </StatusNote>
        ) : added === choice ? (
          // Следующий шаг назван кнопками: «Добавлено» без продолжения было
          // тупиком — куда идти дальше, человек угадывал сам.
          <div className="flex flex-col gap-field">
            <p role="status" className="m-0 text-sm text-success">
              {t("calculator.plan.added", { day: dayLabel, index: chosenMeal })}
            </p>
            <Button
              type="button"
              className="min-h-touch w-full"
              onClick={() =>
                navigate({ tab: "today", view: "menu", dayOffset })
              }
            >
              {t("calculator.plan.openMenu")}
            </Button>
            {afterAdded}
          </div>
        ) : (
          <Button
            type="button"
            className="min-h-touch w-full"
            disabled={save.isPending}
            aria-busy={save.isPending || undefined}
            onClick={() => {
              // Последняя проверка перед записью — не только выключенная
              // кнопка: день, не загруженный достоверно, переписывать нельзя.
              if (!menu.isSuccess) return;
              save.mutate(withDish(itemsOf(menu.data), dish, chosenMeal, 1), {
                onSuccess: () => setAdded(choice),
              });
            }}
          >
            {save.isPending
              ? t("calculator.plan.adding")
              : t("calculator.plan.submit")}
          </Button>
        )}

        {save.isError && (
          <WarningBanner level="danger" title={t("calculator.plan.failed")}>
            {errorMessageOf(save.error) ?? t("menu.compose.failed")}
          </WarningBanner>
        )}
      </>
    );
  }

  // Полоса дней стоит над всем, что зависит от назначения выбранного дня, и
  // не исчезает, пока оно грузится или не пришло: иначе каждый выбор дня
  // снимал полосу, а отказ запроса оставлял семью без способа вернуться к
  // «Сегодня». Без назначения сегодня полоса тоже нужна — оно может начаться
  // через три дня.
  return (
    <div className="flex flex-col gap-field">
      <DayStrip
        label={t("calculator.plan.day")}
        offsets={PLAN_DAYS}
        value={dayOffset}
        menuDates={menuDatesOf(week.data?.days)}
        onChange={(offset) => {
          setDayOffset(offset);
          save.reset();
        }}
      />
      {body}
    </div>
  );
}
