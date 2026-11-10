import { Button, toast } from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Field, SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { todayIso } from "../menu/dates";
import {
  toWriteItem,
  toWriteItems,
  useMealsPerDay,
  useMenuQuery,
  useUpsertMenuMutation,
} from "../menu/useMenu";

const FALLBACK_MEALS = 4;

/**
 * Сохранённое блюдо сразу ставится в день и приём, без поиска в меню.
 *
 * День сохраняется целиком, поэтому кнопка ждёт состав дня: запись из
 * неизвестного состояния стёрла бы позиции, которые уже стоят (ADR-0041).
 */
export function AddSavedDishToPlan({
  patientId,
  dishId,
}: {
  patientId: string;
  dishId: string;
}) {
  const { t } = useTranslation("calculator");
  const [date, setDate] = useState(todayIso);
  const [meal, setMeal] = useState(1);
  const menu = useMenuQuery(patientId, date);
  const upsert = useUpsertMenuMutation(patientId);
  const meals = useMealsPerDay(patientId) ?? FALLBACK_MEALS;
  const dayKnown = menu.data !== undefined && !menu.isFetching;

  function add() {
    upsert.mutate(
      {
        date,
        items: [
          ...toWriteItems(menu.data?.items),
          toWriteItem({
            mealIndex: meal,
            kind: "custom",
            id: dishId,
            portionFactor: 1,
          }),
        ],
      },
      { onSuccess: () => toast.success(t("save.addedToPlan")) },
    );
  }

  return (
    <div className="flex flex-col gap-field">
      <div className="flex flex-wrap items-end gap-field">
        <Field
          id="plan-date"
          type="date"
          width="date"
          label={t("save.planDate")}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <SelectField
          id="plan-meal"
          width="narrow"
          label={t("save.planMeal")}
          value={meal}
          onChange={(event) => setMeal(Number(event.target.value))}
        >
          {Array.from({ length: meals }, (_, index) => index + 1).map(
            (number) => (
              <option key={number} value={number}>
                {t("save.mealNumber", { number })}
              </option>
            ),
          )}
        </SelectField>
        <Button
          type="button"
          variant="outline"
          className="min-h-touch"
          disabled={!dayKnown || date === "" || upsert.isPending}
          onClick={add}
        >
          {t("save.addToPlan")}
        </Button>
      </div>
      {upsert.isError && (
        <FormError>
          {errorMessageOf(upsert.error) ?? t("common:errors.unexpected")}
        </FormError>
      )}
    </div>
  );
}
