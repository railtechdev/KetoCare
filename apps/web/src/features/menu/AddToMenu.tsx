import {
  ActionReason,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from "@ketocare/ui";
import { CalendarPlus } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field, SelectField } from "../../components/Field";
import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { formatDayLabel, todayIso } from "./dates";
import { useAddToMenu, type MenuDish, type MenuSlot } from "./useAddToMenu";
import { DEFAULT_MEAL_COUNT, useMealsPerDay } from "./useMenu";

/** День и приём — два поля, одинаковые везде, где блюдо ставят в меню. */
export function MenuSlotFields({
  patientId,
  slot,
  onChange,
  fixedDate = false,
}: {
  patientId: string;
  slot: MenuSlot;
  onChange: (slot: MenuSlot) => void;
  /** День задан местом (итоги этого дня): спрашивается только приём. */
  fixedDate?: boolean;
}) {
  const { t } = useTranslation("menu");
  const ids = useId();
  const meals = useMealsPerDay(patientId) ?? DEFAULT_MEAL_COUNT;
  // Приём с номером больше назначенного не теряется из выбора: его могли
  // выбрать до смены назначения.
  const count = Math.max(meals, slot.mealIndex);

  return (
    <div className="flex flex-wrap items-end gap-field [&_[data-slot=field]]:mb-0">
      {!fixedDate && (
        <Field
          id={`${ids}-date`}
          type="date"
          width="date"
          label={t("toMenu.date")}
          value={slot.date}
          onChange={(event) => onChange({ ...slot, date: event.target.value })}
        />
      )}
      <SelectField
        id={`${ids}-meal`}
        width="narrow"
        label={t("toMenu.meal")}
        value={slot.mealIndex}
        onChange={(event) =>
          onChange({ ...slot, mealIndex: Number(event.target.value) })
        }
      >
        {Array.from({ length: count }, (_, index) => index + 1).map((index) => (
          <option key={index} value={index}>
            {t("meal.name", { index })}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

/**
 * Выбор дня и приёма и кнопка «Добавить в меню» для готового блюда.
 */
export function AddToMenuForm({
  patientId,
  dish,
  date,
  onAdded,
}: {
  patientId: string;
  dish: MenuDish;
  /** День задан местом; без него — сегодня, с выбором дня. */
  date?: string;
  onAdded?: () => void;
}) {
  const { t } = useTranslation("menu");
  const [slot, setSlot] = useState<MenuSlot>({
    date: date ?? todayIso(),
    mealIndex: 1,
  });
  const menu = useAddToMenu(patientId);
  const reasonId = useId();
  const added = menu.isAdded(dish.id, slot);
  const noDate = slot.date === "";

  return (
    <div className="flex flex-col gap-field">
      <MenuSlotFields
        patientId={patientId}
        slot={slot}
        fixedDate={date !== undefined}
        onChange={(next) => {
          setSlot(next);
          menu.reset();
        }}
      />
      <div>
        <Button
          type="button"
          className="min-h-touch"
          disabled={noDate || added || menu.pending}
          aria-busy={menu.pending || undefined}
          aria-describedby={noDate || added ? reasonId : undefined}
          onClick={() => {
            void menu.add(dish, slot).then((done) => {
              if (!done) return;
              toast.success(
                t("toMenu.added", {
                  title: dish.title,
                  day: formatDayLabel(slot.date),
                  meal: t("meal.name", { index: slot.mealIndex }),
                }),
              );
              onAdded?.();
            });
          }}
        >
          {menu.pending ? t("toMenu.adding") : t("toMenu.submit")}
        </Button>
      </div>
      <ActionReason id={reasonId}>
        {noDate
          ? t("toMenu.noDate")
          : added
            ? t("toMenu.alreadyAdded", {
                day: formatDayLabel(slot.date),
                meal: t("meal.name", { index: slot.mealIndex }),
              })
            : null}
      </ActionReason>
      {menu.error !== null && (
        <FormError>{errorMessageOf(menu.error) ?? t("errors.save")}</FormError>
      )}
    </div>
  );
}

/**
 * «В меню» у блюда в списке: панель с выбором дня и приёма рядом с кнопкой,
 * без ухода на экран меню и поиска блюда там заново.
 */
export function AddToMenuPopover({
  patientId,
  dish,
  date,
  label,
  ariaLabel,
}: {
  patientId: string;
  dish: MenuDish;
  date?: string;
  label: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation("menu");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-touch"
          aria-label={ariaLabel}
        >
          <CalendarPlus aria-hidden="true" className="size-4" />
          <span>{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-80 flex-col gap-field"
        aria-label={t("toMenu.title", { title: dish.title })}
      >
        <p className="m-0 font-medium break-words">
          {t("toMenu.title", { title: dish.title })}
        </p>
        <AddToMenuForm
          patientId={patientId}
          dish={dish}
          date={date}
          onAdded={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
