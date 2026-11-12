import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  formatFactor,
  toast,
} from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { useRemoveMenuItemMutation, type MenuItemRead } from "./useMenu";

/**
 * Блюдо в ячейке недели: нажатие открывает «Убрать из меню».
 *
 * Раньше ячейка только показывала название: ошибочно поставленное блюдо
 * убиралось лишь в сборке дня под сеткой — найти день, прокрутить, найти приём.
 *
 * Правила те же, что в сборке дня:
 * - съеденное не убирается — это уже запись о том, что ребёнок ел, и сервер
 *   такой состав не примет (ADR-0041); ячейка так и говорит;
 * - последнее блюдо дня убирается вместе с меню на день: пустого дня не бывает
 *   (ADR-0018), и об этом сказано до нажатия.
 */
export function WeekCellItem({
  patientId,
  date,
  dayLabel,
  item,
  dayItems,
}: {
  patientId: string;
  date: string;
  dayLabel: string;
  item: MenuItemRead;
  dayItems: readonly MenuItemRead[];
}) {
  const { t } = useTranslation("menu");
  const [open, setOpen] = useState(false);
  const removal = useRemoveMenuItemMutation(patientId);
  const title = item.title ?? t("week.untitled");
  // Только для слов на экране: что на самом деле уйдёт — `PUT` или удаление
  // дня, — решает состав дня на сервере в момент нажатия.
  const last = dayItems.length === 1;
  const pending = removal.isPending;
  const error = removal.error;

  function remove() {
    if (pending) return;
    removal.mutate(
      { date, itemId: item.id },
      {
        onSuccess: (result) => {
          setOpen(false);
          toast.success(
            result.removedDay ? t("remove.done") : t("item.removed"),
          );
        },
      },
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) removal.reset();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="m-0 block w-full rounded-md px-1 py-0.5 text-left break-words hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={t("week.itemActions", { title, day: dayLabel })}
        >
          <span className={item.eaten ? "text-muted-foreground" : undefined}>
            {title}
          </span>
          {item.portion_factor !== 1 && (
            <span className="text-muted-foreground">
              {" "}
              {formatFactor(item.portion_factor)}
            </span>
          )}
          {item.eaten && (
            <span className="text-muted-foreground">
              {" "}
              {t("week.eatenMark")}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-field">
        <p className="m-0 font-medium break-words">{title}</p>
        {item.eaten ? (
          <p className="m-0 text-sm text-muted-foreground">
            {t("item.eatenByFamily")}
          </p>
        ) : (
          <>
            {last && (
              <p className="m-0 text-sm text-muted-foreground">
                {t("item.removeLastDescription", { date: dayLabel })}
              </p>
            )}
            <Button
              type="button"
              variant={last ? "destructive" : "outline"}
              className="min-h-touch self-start"
              disabled={pending}
              aria-busy={pending || undefined}
              onClick={remove}
            >
              {last ? t("item.removeLastConfirm") : t("week.removeItem")}
            </Button>
          </>
        )}
        {error !== null && (
          <FormError>{errorMessageOf(error) ?? t("errors.save")}</FormError>
        )}
      </PopoverContent>
    </Popover>
  );
}
