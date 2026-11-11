import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from "@ketocare/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useCustomDishes } from "../dishes/useCustomDishes";
import {
  toWriteItem,
  toWriteItems,
  useUpsertMenuMutation,
  type MenuItemRead,
} from "./useMenu";

/**
 * «Добавить» в ячейке недели: блюдо ребёнка ставится в этот день и приём
 * одним нажатием, без поиска набором (`docs/AUDIT_ROLES_PATHS_2026-11.md`, этап 3).
 *
 * День пишется целиком, как и в сборке дня: прежние позиции уходят в запрос
 * без изменений, поэтому сервер сохраняет их вместе с отметками «съедено».
 */
export function WeekCellAdd({
  patientId,
  date,
  mealIndex,
  dayItems,
  dayLabel,
}: {
  patientId: string;
  date: string;
  mealIndex: number;
  dayItems: readonly MenuItemRead[] | undefined;
  dayLabel: string;
}) {
  const { t } = useTranslation("menu");
  const [open, setOpen] = useState(false);
  const dishes = useCustomDishes(open ? patientId : null);
  const upsert = useUpsertMenuMutation(patientId);

  const add = (dishId: string, title: string) => {
    upsert.mutate(
      {
        date,
        items: [
          ...toWriteItems(dayItems),
          toWriteItem({
            mealIndex,
            kind: "custom",
            id: dishId,
            portionFactor: 1,
          }),
        ],
      },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success(t("week.added", { title, day: dayLabel }));
        },
        onError: (error) =>
          toast.error(errorMessageOf(error) ?? t("common:errors.unexpected")),
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-start px-1 text-muted-foreground"
          aria-label={t("week.addTo", { day: dayLabel, number: mealIndex })}
        >
          <Plus aria-hidden="true" className="size-4" />
          {t("week.add")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        {dishes.isPending ? (
          <p className="m-0 p-2 text-sm text-muted-foreground">
            {t("week.dishesLoading")}
          </p>
        ) : dishes.isError ? (
          <p className="m-0 p-2 text-sm">{t("week.dishesError")}</p>
        ) : (dishes.data ?? []).length === 0 ? (
          <p className="m-0 p-2 text-sm">{t("week.noDishes")}</p>
        ) : (
          <ul className="m-0 flex max-h-72 list-none flex-col overflow-y-auto p-0">
            {(dishes.data ?? []).map((dish) => (
              <li key={dish.id}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-touch w-full justify-start text-left whitespace-normal"
                  disabled={upsert.isPending}
                  onClick={() => add(dish.id, dish.title)}
                >
                  {dish.title}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
