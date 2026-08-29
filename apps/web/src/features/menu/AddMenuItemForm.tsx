import { zodResolver } from "@hookform/resolvers/zod";
import { FormFooter } from "@ketocare/ui";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Field } from "../../components/Field";
import { DishPicker } from "./DishPicker";
import type { DishOption } from "./useDishCatalog";
import type { DishKind, MealSlot } from "./useMenu";

/**
 * Границы множителя порции — технические, а не медицинские: колонка
 * `menu_items.portion_factor` имеет тип numeric(4,2). Совпадают с проверкой
 * сервера, которая и остаётся защитой (правило 5 CLAUDE.md).
 */
const addItemSchema = z.object({
  dishKey: z.string().min(1),
  portionFactor: z.number().positive().max(99.99),
});

type AddItemValues = z.infer<typeof addItemSchema>;

interface Props {
  patientId: string | null;
  slot: MealSlot;
  pending: boolean;
  onAdd: (input: { kind: DishKind; id: string; portionFactor: number }) => void;
  onCancel: () => void;
}

/**
 * Добавление позиции в приём пищи: блюдо и множитель порции.
 *
 * Приём пищи не спрашивается: форма открывается кнопкой внутри своего слота, и
 * на экране остаётся два поля вместо трёх (раздел 8.3 ТЗ: не больше трёх полей
 * в форме родительского интерфейса). Название приёма пищи остаётся у формы
 * подписью: подписи кнопок подвала одинаковы во всех слотах, и без неё
 * пользователь скринридера не понял бы, в какой приём он добавляет блюдо.
 */
export function AddMenuItemForm({
  patientId,
  slot,
  pending,
  onAdd,
  onCancel,
}: Props) {
  const { t } = useTranslation("menu");
  const [dish, setDish] = useState<DishOption | null>(null);

  const factorId = useId();
  const dishErrorId = useId();

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<AddItemValues>({
    resolver: zodResolver(addItemSchema),
    defaultValues: { dishKey: "", portionFactor: 1 },
  });

  const onSubmit = handleSubmit((values) => {
    if (dish === null) return;
    onAdd({
      kind: dish.kind,
      id: dish.id,
      portionFactor: values.portionFactor,
    });
    setDish(null);
    reset();
  });

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      aria-label={t("slot.addTo", { slot: t(`slots.${slot}`) })}
      className="flex flex-col gap-block rounded-lg border border-border p-4"
    >
      <DishPicker
        patientId={patientId}
        value={dish}
        onSelect={(option) => {
          setDish(option);
          setValue("dishKey", option?.key ?? "", { shouldValidate: true });
        }}
        errorId={errors.dishKey ? dishErrorId : undefined}
        invalid={errors.dishKey !== undefined}
      />
      {errors.dishKey && (
        <p id={dishErrorId} className="m-0 text-sm text-destructive">
          {t("picker.required")}
        </p>
      )}

      <Field
        id={factorId}
        type="number"
        inputMode="decimal"
        min={0.01}
        step={0.1}
        label={t("add.factor")}
        hint={t("add.factorHint")}
        error={errors.portionFactor && t("add.factorInvalid")}
        {...register("portionFactor", { valueAsNumber: true })}
      />

      <FormFooter
        submitLabel={t("add.submit")}
        pendingLabel={t("add.submitting")}
        pending={pending}
        cancelLabel={t("slot.cancel")}
        onCancel={onCancel}
      />
    </form>
  );
}
