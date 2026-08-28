import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { errorMessageOf } from "../../lib/api";
import { CopyDayForm } from "./CopyDayForm";
import { DayNavigator } from "./DayNavigator";
import { DayTotalsPanel } from "./DayTotalsPanel";
import { MenuSlotSection } from "./MenuSlotSection";
import { todayIso } from "./dates";
import { useMenuItemTitles } from "./useDishCatalog";
import {
  MEAL_SLOTS,
  toWriteItem,
  toWriteItems,
  useDayTolerance,
  useEatenMutation,
  useMenuQuery,
  useUpsertMenuMutation,
  type DishKind,
  type MealSlot,
} from "./useMenu";

/**
 * Меню дня для родителя (раздел 8.3 ТЗ, строка «Меню»).
 *
 * День сохраняется целиком: любая правка состава уходит на сервер тем же PUT, а
 * итоги дня приходят из ответа. Считать их на клиенте нельзя — кетосоотношение
 * не аддитивно, и сумма показателей блюд не равна показателям дня.
 */
export function MenuPage({ patientId }: { patientId: string }) {
  const { t } = useTranslation("menu");
  const [date, setDate] = useState(todayIso);

  const menu = useMenuQuery(patientId, date);
  const upsert = useUpsertMenuMutation(patientId);
  const eaten = useEatenMutation(patientId, date);
  const tolerance = useDayTolerance(patientId, date);

  const items = useMemo(() => menu.data?.items ?? [], [menu.data]);
  const titles = useMenuItemTitles(patientId, items);

  function addItem(input: {
    slot: MealSlot;
    kind: DishKind;
    id: string;
    portionFactor: number;
  }) {
    upsert.mutate({
      date,
      items: [...toWriteItems(items), toWriteItem(input)],
    });
  }

  function removeItem(itemId: string) {
    const rest = toWriteItems(items.filter((item) => item.id !== itemId));
    // Пустой день сервер не принимает (в меню минимум одна позиция), поэтому
    // кнопка удаления последней позиции заблокирована — сюда это не доходит.
    if (rest.length === 0) return;
    upsert.mutate({ date, items: rest });
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="m-0 text-xl font-semibold">{t("title")}</h1>

      <DayNavigator date={date} onChange={setDate} />

      <>
        {menu.isLoading && (
          <p role="status" className="text-muted">
            {t("loading")}
          </p>
        )}

        {menu.isError && (
          <FormError>
            {errorMessageOf(menu.error) ?? t("errors.load")}
          </FormError>
        )}

        <DayTotalsPanel
          totals={menu.data?.totals ?? null}
          engineVersion={menu.data?.engine_version ?? null}
          tolerance={tolerance}
        />

        {upsert.isError && (
          <FormError>
            {errorMessageOf(upsert.error) ?? t("errors.save")}
          </FormError>
        )}

        {eaten.isError && (
          <FormError>
            {errorMessageOf(eaten.error) ?? t("common:errors.unexpected")}
          </FormError>
        )}

        {upsert.isPending && (
          <p role="status" className="m-0 text-muted">
            {t("day.saving")}
          </p>
        )}

        {items.length === 0 && !menu.isLoading && !menu.isError && (
          <p className="m-0 text-muted">{t("day.empty")}</p>
        )}

        <div className="flex flex-col gap-4">
          {MEAL_SLOTS.map((slot) => (
            <MenuSlotSection
              key={slot}
              slot={slot}
              items={items.filter((item) => item.meal_slot === slot)}
              titles={titles}
              patientId={patientId}
              canRemove={items.length > 1}
              pending={upsert.isPending}
              onAdd={addItem}
              onRemove={removeItem}
              onToggleEaten={(itemId, value) =>
                eaten.mutate({ itemId, eaten: value })
              }
            />
          ))}
        </div>

        {items.length === 1 && (
          <p className="m-0 text-sm text-muted">{t("item.lastOne")}</p>
        )}

        {/* key по дате: форма перечитывает дату-источник по умолчанию и
              не показывает «день скопирован» после перехода к другому дню. */}
        <CopyDayForm key={date} patientId={patientId} date={date} />
      </>
    </section>
  );
}
