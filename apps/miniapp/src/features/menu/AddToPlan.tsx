import {
  Button,
  FieldShell,
  NativeSelect,
  SegmentedControl,
  StatusNote,
  WarningBanner,
} from "@ketocare/ui";
import { type ReactNode, useContext, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { NavigateContext } from "../../lib/tabs";
import { usePatientOverview } from "../home/useOverview";
import { itemsOf, mealNumbers, withDish } from "./dayPlan";
import { dayAt, useMenu } from "./useMenu";
import { useSaveMenu } from "./useSaveMenu";

/** Дни, в которые ставят блюдо отсюда: вчерашнее меню не собирают. */
const DAYS = [
  { offset: 0, label: "menu.today" },
  { offset: 1, label: "menu.tomorrow" },
] as const;

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
  const [dayOffset, setDayOffset] = useState<number>(0);
  const overview = usePatientOverview(patientId);
  const meals = mealNumbers(overview.data?.prescription?.meals_per_day ?? null);
  const [mealIndex, setMealIndex] = useState<number | null>(null);
  const chosenMeal = mealIndex ?? meals[0] ?? null;

  const day = dayAt(dayOffset);
  const menu = useMenu(patientId, day);
  const save = useSaveMenu(patientId, day);
  // Какое добавление уже сделано: повторное нажатие поставило бы блюдо в тот же
  // приём второй раз. Другой день или приём — другое добавление.
  const [added, setAdded] = useState<string | null>(null);
  const choice = `${day}:${chosenMeal ?? ""}`;

  if (!overview.isSuccess) {
    return <StatusNote>{t("calculator.plan.prescriptionUnknown")}</StatusNote>;
  }
  if (meals.length === 0 || chosenMeal === null) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        {t("calculator.plan.noPrescription")}
      </p>
    );
  }

  const planKnown = menu.isSuccess;
  const dayLabel = t(
    DAYS.find((option) => option.offset === dayOffset)?.label ?? "menu.today",
  );

  return (
    <div className="flex flex-col gap-field">
      <SegmentedControl
        label={t("calculator.plan.day")}
        value={String(dayOffset)}
        onChange={(value) => {
          setDayOffset(Number(value));
          save.reset();
        }}
        items={DAYS.map((option) => ({
          value: String(option.offset),
          label: t(option.label),
        }))}
        className="w-full [&>label]:flex-1"
      />

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
            onClick={() => navigate({ tab: "today", view: "menu", dayOffset })}
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
    </div>
  );
}
