import { AsyncSection, EmptyState, toast } from "@ketocare/ui";
import { UtensilsCrossed } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { CopyDayForm } from "./CopyDayForm";
import { DayNavigator } from "./DayNavigator";
import { DayTotalsPanel } from "./DayTotalsPanel";
import { MenuSkeleton } from "./MenuSkeleton";
import { MenuSlotSection } from "./MenuSlotSection";
import { todayIso } from "./dates";
import { useMenuItemTitles } from "./useDishCatalog";
import {
  MEAL_SLOTS,
  toWriteItem,
  toWriteItems,
  useDayTargets,
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
  const targets = useDayTargets(patientId, date);

  const items = useMemo(() => menu.data?.items ?? [], [menu.data]);
  const titles = useMenuItemTitles(patientId, items);

  // Пустое состояние дня. Оно же уходит в `empty` у AsyncSection: день без
  // позиций рисуется вместе с приёмами пищи (иначе в них нечем добавить первое
  // блюдо), поэтому один и тот же блок нужен и как подсказка над составом.
  const emptyDayState = (
    <EmptyState
      icon={UtensilsCrossed}
      title={t("day.emptyTitle")}
      description={t("day.empty")}
    />
  );

  function addItem(input: {
    slot: MealSlot;
    kind: DishKind;
    id: string;
    portionFactor: number;
  }) {
    upsert.mutate(
      {
        date,
        items: [...toWriteItems(items), toWriteItem(input)],
      },
      { onSuccess: () => toast.success(t("item.added")) },
    );
  }

  function removeItem(itemId: string) {
    const rest = toWriteItems(items.filter((item) => item.id !== itemId));
    // Пустой день сервер не принимает (в меню минимум одна позиция), поэтому
    // кнопка удаления последней позиции заблокирована — сюда это не доходит.
    if (rest.length === 0) return;
    upsert.mutate(
      { date, items: rest },
      { onSuccess: () => toast.success(t("item.removed")) },
    );
  }

  return (
    <PageLayout title={t("title")} intro={t("intro")}>
      <DayNavigator date={date} onChange={setDate} />

      {/* Правило четырёх состояний — в AsyncSection: там же записано, почему
          ошибка не должна прятать уже показанный состав дня. */}
      <AsyncSection
        loading={menu.isLoading}
        skeleton={<MenuSkeleton />}
        error={
          menu.isError
            ? {
                title: t("errors.load"),
                description:
                  errorMessageOf(menu.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void menu.refetch()}
        // «Показывать нечего» — это отсутствие ответа сервера. День, которого
        // ещё нет, сервер отдаёт как `null`, и это уже ответ: экран рисует
        // приёмы пищи, чтобы в них можно было добавить блюдо.
        isEmpty={menu.data === undefined}
        empty={emptyDayState}
      >
        <DayTotalsPanel
          totals={menu.data?.totals ?? null}
          engineVersion={menu.data?.engine_version ?? null}
          tolerance={tolerance}
          targets={targets}
        />

        {/* Ошибка отправки, а не загрузки: повторять нечего, состав дня
            остался прежним (правило П16 канона). */}
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
          <p role="status" className="m-0 text-muted-foreground">
            {t("day.saving")}
          </p>
        )}

        {items.length === 0 && emptyDayState}

        <div className="flex flex-col gap-block">
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
          <p className="m-0 text-sm text-muted-foreground">
            {t("item.lastOne")}
          </p>
        )}
      </AsyncSection>

      {/* key по дате: форма перечитывает дату-источник по умолчанию и
          не предлагает скопировать день сам в себя после перехода. */}
      <CopyDayForm key={date} patientId={patientId} date={date} />
    </PageLayout>
  );
}
