import { AsyncSection, Button, FormSheet, Section, toast } from "@ketocare/ui";
import { CopyPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { AddMenuItemForm } from "./AddMenuItemForm";
import { CopyDayForm } from "./CopyDayForm";
import { DayNavigator } from "./DayNavigator";
import { DayTotalsPanel } from "./DayTotalsPanel";
import { MealSlotGroup } from "./MealSlotGroup";
import { WithdrawnProductsNotice } from "./WithdrawnProductsNotice";
import { withdrawnByItem } from "./withdrawn";
import { MenuSkeleton } from "./MenuSkeleton";
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
 *
 * Порядок блоков: чем день заканчивается (итоги) — только когда есть что
 * считать, дальше сам день. Копирование дня и добавление блюда открываются
 * панелями: первое — редкое действие, второму нужен контекст приёма пищи, и ни
 * одно из них не должно занимать высоту постоянно (правила П27, П31, П32).
 */
export function MenuPage({ patientId }: { patientId: string }) {
  const { t } = useTranslation("menu");
  const [date, setDate] = useState(todayIso);
  /** Приём пищи, в который добавляют блюдо; `null` — панель закрыта */
  const [addingSlot, setAddingSlot] = useState<MealSlot | null>(null);
  const [copying, setCopying] = useState(false);

  const menu = useMenuQuery(patientId, date);
  const upsert = useUpsertMenuMutation(patientId);
  const eaten = useEatenMutation(patientId, date);
  const tolerance = useDayTolerance(patientId, date);
  const targets = useDayTargets(patientId, date);

  const items = useMemo(() => menu.data?.items ?? [], [menu.data]);
  const withdrawn = withdrawnByItem(menu.data?.withdrawn_products);
  const titles = useMenuItemTitles(patientId, items);
  // Приёмы, а не блюда: в один приём их может быть несколько, а врач назначает
  // именно число приёмов.
  const plannedSlots = new Set(items.map((item) => item.meal_slot)).size;

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
    <PageLayout
      title={t("title")}
      intro={t("intro")}
      actions={
        <Button
          type="button"
          variant="outline"
          onClick={() => setCopying(true)}
        >
          <CopyPlus aria-hidden="true" />
          {t("copy.title")}
        </Button>
      }
    >
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
        empty={null}
      >
        {/* Над итогами: числа дня посчитаны в том числе по выведенному
            продукту, и знать об этом нужно раньше, чем смотреть на них. */}
        <WithdrawnProductsNotice withdrawn={menu.data?.withdrawn_products} />

        {/* Итогов у пустого дня нет, и говорить об этом отдельным блоком не
            нужно: о пустом дне говорит подпись блока приёмов пищи. Раньше два
            блока подряд сообщали одно и то же на 332 px (правило П27). */}
        {items.length > 0 && (
          <DayTotalsPanel
            totals={menu.data?.totals ?? null}
            engineVersion={menu.data?.engine_version ?? null}
            tolerance={tolerance}
            targets={targets}
          />
        )}

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

        {/* Сколько приёмов назначил врач — и сколько в плане на этот день.
            Поле `meals_per_day` заполняется с первого назначения и до сих пор
            не доходило ни до одного экрана семьи: она планировала день, не
            зная, о скольких приёмах договорились. */}
        <Section
          title={t("meals.title")}
          description={
            items.length === 0
              ? t("day.empty")
              : targets === null
                ? undefined
                : t("meals.planned", {
                    prescribed: targets.mealsPerDay,
                    planned: plannedSlots,
                  })
          }
          contentClassName="gap-0 divide-y divide-border"
        >
          {MEAL_SLOTS.map((slot) => (
            <MealSlotGroup
              key={slot}
              slot={slot}
              items={items.filter((item) => item.meal_slot === slot)}
              titles={titles}
              withdrawnByItem={withdrawn}
              canRemove={items.length > 1}
              pending={upsert.isPending}
              onAdd={() => setAddingSlot(slot)}
              onRemove={removeItem}
              onToggleEaten={(itemId, value) =>
                eaten.mutate({ itemId, eaten: value })
              }
            />
          ))}
        </Section>

        {upsert.isPending && (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {t("day.saving")}
          </p>
        )}

        {items.length === 1 && (
          <p className="m-0 text-sm text-muted-foreground">
            {t("item.lastOne")}
          </p>
        )}
      </AsyncSection>

      <FormSheet
        open={addingSlot !== null}
        onOpenChange={(open) => {
          if (!open) setAddingSlot(null);
        }}
        title={
          addingSlot === null
            ? t("slot.add")
            : t("slot.addTo", { slot: t(`slots.${addingSlot}`) })
        }
      >
        {addingSlot !== null && (
          <AddMenuItemForm
            patientId={patientId}
            slot={addingSlot}
            pending={upsert.isPending}
            onAdd={(input) => {
              addItem({ slot: addingSlot, ...input });
              setAddingSlot(null);
            }}
            onCancel={() => setAddingSlot(null)}
          />
        )}
      </FormSheet>

      {/* key по дате: форма перечитывает дату-источник по умолчанию и
          не предлагает скопировать день сам в себя после перехода. */}
      <FormSheet
        open={copying}
        onOpenChange={setCopying}
        title={t("copy.title")}
        description={t("copy.hint")}
      >
        <CopyDayForm
          key={date}
          patientId={patientId}
          date={date}
          onCopied={() => setCopying(false)}
        />
      </FormSheet>
    </PageLayout>
  );
}
