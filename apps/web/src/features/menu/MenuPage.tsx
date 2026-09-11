import {
  AsyncSection,
  Button,
  Columns,
  ConfirmDialog,
  FormSheet,
  Section,
  toast,
} from "@ketocare/ui";
import { CopyPlus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormError } from "../../components/FormError";
import { PageLayout } from "../../components/PageLayout";
import { errorMessageOf } from "../../lib/api";
import { AddMenuItemForm } from "./AddMenuItemForm";
import { CopyDayForm } from "./CopyDayForm";
import { DayNavigator } from "./DayNavigator";
import { DayTotalsPanel } from "./DayTotalsPanel";
import { MealGroup } from "./MealGroup";
import {
  ExcludedProductsNotice,
  WithdrawnProductsNotice,
} from "./WithdrawnProductsNotice";
import { withdrawnByItem } from "./withdrawn";
import { MenuSkeleton } from "./MenuSkeleton";
import { formatDayLabel, todayIso } from "./dates";
import { useMenuItemTitles } from "./useDishCatalog";
import {
  mealIndexes,
  toWriteItem,
  toWriteItems,
  useDayTargets,
  useMealsPerDay,
  useDayTolerance,
  useDeleteMenuMutation,
  useEatenMutation,
  useMenuQuery,
  useUpsertMenuMutation,
  type DishKind,
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
  /** Номер приёма, в который добавляют блюдо; `null` — панель закрыта */
  const [addingMeal, setAddingMeal] = useState<number | null>(null);
  const [copying, setCopying] = useState(false);

  const menu = useMenuQuery(patientId, date);
  const removeDay = useDeleteMenuMutation(patientId);
  const upsert = useUpsertMenuMutation(patientId);
  const eaten = useEatenMutation(patientId, date);
  const dayTolerance = useDayTolerance(patientId, date);
  const targets = useDayTargets(patientId, date);

  const items = useMemo(() => menu.data?.items ?? [], [menu.data]);
  const planned = menu.data !== undefined && items.length > 0;
  const humanDate = formatDayLabel(date);
  const withdrawn = withdrawnByItem(menu.data?.withdrawn_products);
  const titles = useMenuItemTitles(patientId, items);
  // Приёмы, а не блюда: в один приём их может быть несколько, а врач назначает
  // именно число приёмов.
  const plannedMeals = new Set(items.map((item) => item.meal_index)).size;
  // Сколько приёмов показывать. До ADR-0029 их было ровно четыре, и назначение
  // на шесть приёмов в дне не раскладывалось вовсе.
  const mealsPerDay = useMealsPerDay(patientId);
  const meals = mealIndexes(mealsPerDay, items);

  function addItem(input: {
    mealIndex: number;
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
    // План дня и итоги стоят рядом — это просит ширины (правило П34 канона).
    <PageLayout
      title={t("title")}
      intro={t("intro")}
      width="wide"
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => setCopying(true)}
          >
            <CopyPlus aria-hidden="true" />
            {t("copy.title")}
          </Button>

          {/* Выход из ошибочно составленного дня. Показывается только когда
              день есть: кнопка, которая ничего не убирает, — обещание без
              содержания (ADR-0018). */}
          {planned && (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="outline">
                  <Trash2 aria-hidden="true" />
                  {t("remove.action")}
                </Button>
              }
              title={t("remove.confirmTitle", { date: humanDate })}
              description={t("remove.confirmBody")}
              confirmLabel={t("remove.confirm")}
              cancelLabel={t("common:actions.cancel")}
              destructive
              onConfirm={() =>
                removeDay.mutate(date, {
                  onSuccess: () => toast.success(t("remove.done")),
                  onError: (error) =>
                    toast.error(
                      errorMessageOf(error) ?? t("common:errors.unexpected"),
                    ),
                })
              }
            />
          )}
        </>
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
        {/* Исключённое ребёнку — выше выведенного из оборота: первое про то,
            можно ли это давать, второе — про то, верны ли числа. */}
        <ExcludedProductsNotice excluded={menu.data?.excluded_products} />

        <WithdrawnProductsNotice withdrawn={menu.data?.withdrawn_products} />

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
        {/* Итоги дня — рядом с составом, а не над ним. Семья добавляет блюдо и
            смотрит, что стало с соотношением: пока итоги стояли отдельным
            блоком сверху, каждое добавление требовало прокрутки вверх и обратно.
            Приставная колонка закреплена — итоги остаются на виду, пока идёт
            работа с приёмами пищи.

            Итогов у пустого дня нет, и говорить об этом отдельным блоком не
            нужно: о пустом дне говорит подпись блока приёмов пищи. Раньше два
            блока подряд сообщали одно и то же на 332 px (правило П27). */}
        <Columns
          asideLabel={t("totals.title")}
          asideSticky
          // Итоги читаются раньше состава и на телефоне: до этого они стояли
          // НАД приёмами пищи, а приставная колонка в разметке идёт после
          // основной — на узком экране семья находила бы соотношение и
          // «осталось до цели» под шестью слотами. Телефон у семьи — основной
          // сценарий, и разворот приоритета на нём дороже выигрыша на широком.
          asideFirst
          aside={
            items.length > 0 ? (
              <DayTotalsPanel
                totals={menu.data?.totals ?? null}
                engineVersion={menu.data?.engine_version ?? null}
                tolerance={dayTolerance.tolerance}
                toleranceGap={dayTolerance.gap}
                targets={targets}
              />
            ) : null
          }
          main={
            <Section
              title={t("meals.title")}
              description={
                items.length === 0
                  ? t("day.empty")
                  : mealsPerDay === null
                    ? undefined
                    : t("meals.planned", {
                        prescribed: mealsPerDay,
                        planned: plannedMeals,
                      })
              }
              contentClassName="gap-0 divide-y divide-border"
            >
              {meals.map((mealIndex) => (
                <MealGroup
                  key={mealIndex}
                  mealIndex={mealIndex}
                  items={items.filter((item) => item.meal_index === mealIndex)}
                  titles={titles}
                  withdrawnByItem={withdrawn}
                  canRemove={items.length > 1}
                  pending={upsert.isPending}
                  onAdd={() => setAddingMeal(mealIndex)}
                  onRemove={removeItem}
                  onToggleEaten={(itemId, value) =>
                    eaten.mutate({ itemId, eaten: value })
                  }
                />
              ))}
            </Section>
          }
        />

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
        closeLabel={t("common:actions.close")}
        open={addingMeal !== null}
        onOpenChange={(open) => {
          if (!open) setAddingMeal(null);
        }}
        title={
          addingMeal === null
            ? t("meal.add")
            : t("meal.addTo", { meal: t("meal.name", { index: addingMeal }) })
        }
      >
        {addingMeal !== null && (
          <AddMenuItemForm
            patientId={patientId}
            mealIndex={addingMeal}
            pending={upsert.isPending}
            onAdd={(input) => {
              addItem({ mealIndex: addingMeal, ...input });
              setAddingMeal(null);
            }}
            onCancel={() => setAddingMeal(null)}
          />
        )}
      </FormSheet>

      {/* key по дате: форма перечитывает дату-источник по умолчанию и
          не предлагает скопировать день сам в себя после перехода. */}
      <FormSheet
        closeLabel={t("common:actions.close")}
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
