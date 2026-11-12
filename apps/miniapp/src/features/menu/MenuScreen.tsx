import {
  AsyncSection,
  Button,
  SegmentedControl,
  Section,
  WarningBanner,
  formatDayTime,
  formatMass,
} from "@ketocare/ui";
import { ArrowLeft, ChefHat, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ExternalLink } from "../../components/ExternalLink";
import { RemoveButton } from "../../components/RemoveButton";
import { TelegramConfirmDialog } from "../../components/TelegramConfirmDialog";
import { errorMessageOf } from "../../lib/api";
import { useTelegramBack } from "../../lib/useTelegram";
import { usePatientOverview } from "../home/useOverview";
import { RecipeCard } from "../recipes/RecipesScreen";
import type { Session } from "../session/useSession";
import { ComposePanel, type ComposeChoice } from "./ComposePanel";
import { DayTotals, type DayTargets, type DayVerdictInput } from "./DayTotals";
import {
  copiedDay,
  itemsOf,
  mealNumbers,
  mealsOfDay,
  withDish,
  withoutItem,
} from "./dayPlan";
import { MealItem } from "./MealItem";
import type { Menu, MenuItem } from "./useMenu";
import { dayAt, isPlanChanged, useMarkEaten, useMenu } from "./useMenu";
import { useSaveMenu } from "./useSaveMenu";

/**
 * Дни, между которыми переключается экран: вчера, сегодня, завтра.
 *
 * Вчера — чтобы отметить съеденное задним числом (вечером отмечать некогда, а
 * по отметкам врач судит, выполнялось ли меню) и посмотреть, что ребёнок ел.
 * Завтра — меню собирают вечером на завтра. Календаря нет: см. `dayAt`.
 */
const DAYS = [
  { offset: -1, label: "menu.yesterday" },
  { offset: 0, label: "menu.today" },
  { offset: 1, label: "menu.tomorrow" },
] as const;

/** Подпись «Как вчера» с точки зрения выбранного дня. */
const COPY_LABEL: Record<number, string> = {
  [-1]: "menu.copy.asDayBeforeYesterday",
  0: "menu.copy.asYesterday",
  1: "menu.copy.asToday",
};

/**
 * Меню дня с отметками «съедено» и сборкой (раздел 9 ТЗ, ADR-0041, ADR-0075).
 *
 * Живёт внутри вкладки «Сегодня» — экраном, на который ведёт «Открыть меню».
 * Показаны ВСЕ назначенные приёмы, в том числе пустые, и у каждого своя
 * кнопка «+ блюдо»: прежде пустой приём был не виден вовсе.
 *
 * Свободного текста здесь нет: придуманная еда попала бы в итоги дня наравне с
 * настоящей. Состав собирается только из опубликованных рецептов и блюд
 * ребёнка, а итоги считает ядро на сервере.
 */
export function MenuScreen({
  session,
  onBack,
  initialDayOffset = 0,
}: {
  session: Session;
  /** Вернуться на «Сегодня». Нет — экран открыт сам по себе (тесты). */
  onBack?: () => void;
  initialDayOffset?: number;
}) {
  const { t } = useTranslation();
  // Хранится СДВИГ, а не дата: приложение, открытое в 23:58, после полуночи
  // иначе показывало бы вчерашнее меню, не подсветив ни одной кнопки — а
  // «собрать вечером на завтра» это ровно про то время суток.
  const [dayOffset, setDayOffset] = useState(initialDayOffset);
  const [composing, setComposing] = useState<number | null>(null);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const day = dayAt(dayOffset);
  const menu = useMenu(session.patientId, day);
  const mark = useMarkEaten(session.patientId, day);
  const save = useSaveMenu(session.patientId, day);
  // Перенос дня — своей мутацией: её отказ называется у кнопки переноса, а
  // отказ добавления блюда — в панели сборки.
  const copy = useSaveMenu(session.patientId, day);
  // Число приёмов задаёт врач; без назначения раскладывать день не по чему.
  const overview = usePatientOverview(session.patientId);
  const prescription = overview.data?.prescription ?? null;
  const meals = mealNumbers(prescription?.meals_per_day ?? null);
  // Цели — из назначения, а не из сводки за день: сводка посчитана для
  // сегодня, а назначение действует и завтра.
  const targets: DayTargets | null =
    prescription === null
      ? null
      : {
          kcalPerDay: prescription.kcal_per_day,
          carbsLimitG: prescription.carbs_limit_g,
        };

  // «Назад» Telegram ведёт на «Сегодня». Панель сборки и карточка рецепта
  // ставят свою кнопку поверх этой — срабатывает верхняя.
  useTelegramBack(onBack ?? null);

  // **Состав дня обязан быть известен достоверно.** `PUT` задаёт весь день, и
  // отправленный из незагруженного состояния он означает «день теперь состоит
  // только из этого»: прежние позиции сервер мягко удалит вместе с отметками
  // «съедено». Право писать даёт только успешный ответ.
  const planKnown = menu.isSuccess;
  // Собирать можно, только когда известны и состав, и приёмы из назначения.
  // Без назначения кнопок сборки нет вовсе — вместо них одна строка: панель,
  // из которой нечего выбрать, была тупиком (аудит 12.11.2026).
  const canCompose = planKnown && meals.length > 0;

  // «Как вчера» предлагается только достоверно ПУСТОМУ дню (см. `copiedDay`).
  const dayEmpty = planKnown && (menu.data?.items.length ?? 0) === 0;
  const previous = useMenu(session.patientId, dayAt(dayOffset - 1), {
    enabled: dayEmpty,
  });
  const copied =
    dayEmpty && previous.isSuccess
      ? copiedDay(previous.data ?? null, menu.data ?? null)
      : null;

  // Вердикт о допуске сервер считает только за сегодня и отдаёт в сводке.
  // Пока сводка перезагружается после правки меню, вердикт относится к
  // прежнему составу: лучше промолчать, чем показать чужое.
  const verdictFresh =
    overview.isSuccess && !overview.isFetching && overview.data.date === day;
  const verdict: DayVerdictInput = {
    otherDay: dayOffset !== 0,
    tolerance: verdictFresh ? (overview.data.day?.tolerance ?? null) : null,
    gap: verdictFresh ? (overview.data.day?.tolerance_gap ?? null) : null,
  };

  const addDish = (
    { dish, mealIndex, portionFactor }: ComposeChoice,
    onAdded: () => void,
  ) => {
    if (!planKnown || copy.isPending) return;
    save.mutate(
      withDish(itemsOf(menu.data ?? null), dish, mealIndex, portionFactor),
      { onSuccess: onAdded },
    );
  };

  if (recipeId !== null) {
    return (
      <RecipeCard
        recipeId={recipeId}
        patientId={session.patientId}
        onBack={() => setRecipeId(null)}
      />
    );
  }

  return (
    <main className="flex flex-col gap-section p-section">
      {onBack !== undefined && composing === null && (
        <Button
          variant="ghost"
          className="min-h-touch self-start"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t("menu.backToToday")}
        </Button>
      )}
      <h1 className="text-page-title">
        {composing === null
          ? t("menu.title")
          : t("menu.compose.title", { day: t(dayLabelKey(dayOffset)) })}
      </h1>

      {composing !== null ? (
        <ComposePanel
          patientId={session.patientId}
          meals={meals}
          initialMeal={composing}
          saving={save.isPending || copy.isPending}
          saveError={save.isError ? save.error : null}
          onAdd={addDish}
          onDone={() => {
            save.reset();
            setComposing(null);
          }}
        />
      ) : (
        <>
          {/* Три дня, а не календарь (см. `DAYS`). */}
          <SegmentedControl
            label={t("menu.day")}
            value={String(dayOffset)}
            onChange={(value) => {
              setDayOffset(Number(value));
              // Отказ записи относится к дню, где её делали.
              save.reset();
              copy.reset();
            }}
            items={DAYS.map((option) => ({
              value: String(option.offset),
              label: t(option.label),
            }))}
            className="w-full [&>label]:flex-1"
          />

          <AsyncSection
            loading={menu.isPending}
            skeleton={null}
            error={
              menu.isError
                ? {
                    title: t("menu.loadError"),
                    description:
                      errorMessageOf(menu.error) ?? t("home.loadErrorHint"),
                  }
                : null
            }
            waiting={
              menu.fetchStatus === "paused"
                ? t("errors.waitingForNetwork")
                : null
            }
            retryLabel={t("actions.retry")}
            onRetry={() => void menu.refetch()}
            isEmpty={false}
            empty={null}
          >
            {planKnown && (
              <div className="flex flex-col gap-section">
                {dayEmpty && (
                  <p className="m-0 text-muted-foreground">{t("menu.none")}</p>
                )}
                {/* Без назначения приёмов нет: их задаёт врач (ADR-0029).
                    «Назначения нет» — утверждение о клиническом факте, и
                    говорить его из незнания нельзя: сводка могла ещё не прийти. */}
                {!overview.isSuccess ? (
                  <p className="m-0 text-muted-foreground">
                    {t("menu.compose.prescriptionUnknown")}
                  </p>
                ) : (
                  meals.length === 0 && (
                    <p className="m-0 text-muted-foreground">
                      {t("menu.compose.noPrescription")}
                    </p>
                  )
                )}

                {/* «Как вчера»: кето-меню повторяются, и собирать одинаковый
                    день заново по блюду — шесть поисков вместо одного нажатия.
                    Только в пустой день: перенос поверх непустого стёр бы
                    отметки. */}
                {copied !== null && canCompose && (
                  <div className="flex flex-col gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-touch w-full"
                      disabled={copy.isPending || save.isPending}
                      aria-busy={copy.isPending || undefined}
                      onClick={() => {
                        if (!dayEmpty) return;
                        copy.mutate(copied);
                      }}
                    >
                      {copy.isPending
                        ? t("menu.copy.copying")
                        : t(COPY_LABEL[dayOffset] ?? "menu.copy.asYesterday")}
                    </Button>
                    <p className="m-0 text-sm text-muted-foreground">
                      {t("menu.copy.hint")}
                    </p>
                  </div>
                )}
                {dayEmpty &&
                  canCompose &&
                  previous.isSuccess &&
                  copied === null && (
                    <p className="m-0 text-sm text-muted-foreground">
                      {t("menu.copy.sourceEmpty")}
                    </p>
                  )}
                {copy.isError && (
                  <WarningBanner level="danger" title={t("menu.copy.failed")}>
                    {errorMessageOf(copy.error) ?? t("menu.compose.failed")}
                  </WarningBanner>
                )}

                <DayPlan
                  menu={menu.data ?? null}
                  meals={mealsOfDay(meals, menu.data?.items ?? [])}
                  canMarkEaten={dayOffset <= 0}
                  canCompose={canCompose}
                  onCompose={setComposing}
                  onOpenRecipe={setRecipeId}
                  onToggle={(item) =>
                    mark.mutate({ itemId: item.id, eaten: !item.eaten })
                  }
                  onRemove={(item) => {
                    if (!planKnown) return;
                    save.mutate(withoutItem(menu.data ?? null, item.id));
                  }}
                  removing={save.isPending}
                  targets={targets}
                  verdict={verdict}
                  // Отказ записи называется словами над меню: «Убрать»
                  // нажимают при закрытой панели, и её сообщение туда не
                  // доходит. Отметку отвергли, потому что меню в ту же минуту
                  // пересохранили без этого блюда (Н10): сказать это можно
                  // только над меню.
                  saveFailed={
                    save.isError
                      ? (errorMessageOf(save.error) ?? t("menu.compose.failed"))
                      : mark.isError && isPlanChanged(mark.error)
                        ? (errorMessageOf(mark.error) ??
                          t("menu.markFailedHint"))
                        : null
                  }
                  pendingId={
                    mark.isPending ? mark.variables?.itemId : undefined
                  }
                  failedId={
                    mark.isError && !isPlanChanged(mark.error)
                      ? mark.variables?.itemId
                      : undefined
                  }
                  failure={
                    errorMessageOf(mark.error) ?? t("menu.markFailedHint")
                  }
                />

                {/* Ссылка на кабинет — только тем, у кого он включён: у
                    взрослого из Telegram кабинета чаще всего нет. */}
                {dayEmpty && session.hasWebCredentials && (
                  <ExternalLink
                    className="text-primary underline underline-offset-4"
                    href={session.webUrl}
                  >
                    {t("menu.openWeb")}
                  </ExternalLink>
                )}
              </div>
            )}
          </AsyncSection>
        </>
      )}
    </main>
  );
}

function dayLabelKey(offset: number): string {
  return DAYS.find((option) => option.offset === offset)?.label ?? "menu.today";
}

function DayPlan({
  menu,
  meals,
  canMarkEaten,
  canCompose,
  onCompose,
  onOpenRecipe,
  onToggle,
  onRemove,
  removing,
  saveFailed,
  targets,
  verdict,
  pendingId,
  failedId,
  failure,
}: {
  menu: Menu | null;
  meals: number[];
  canMarkEaten: boolean;
  canCompose: boolean;
  onCompose: (mealIndex: number) => void;
  onOpenRecipe: (recipeId: string) => void;
  onToggle: (item: MenuItem) => void;
  onRemove: (item: MenuItem) => void;
  removing: boolean;
  saveFailed: string | null;
  targets: DayTargets | null;
  verdict: DayVerdictInput;
  pendingId: string | undefined;
  failedId: string | undefined;
  failure: string;
}) {
  const { t } = useTranslation();
  const items = menu?.items ?? [];

  return (
    <div className="flex flex-col gap-section">
      {!canMarkEaten && items.length > 0 && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("menu.tomorrowNoEaten")}
        </p>
      )}
      {saveFailed !== null && (
        <WarningBanner level="danger" title={t("menu.compose.removeFailed")}>
          {saveFailed}
        </WarningBanner>
      )}

      {/* Меню составил специалист — семья должна это видеть (ADR-0047). */}
      {menu?.updated_by_name && menu.updated_by_role !== "parent" && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("menu.composedBy", {
            name: menu.updated_by_name,
            when: formatDayTime(new Date(menu.updated_at)),
          })}
        </p>
      )}

      {menu !== null && menu.excluded_products.length > 0 && (
        // Молчать нельзя: по этому меню кормят сегодня. Но и запрещать день
        // нельзя — исключения уточняются по ходу терапии (вопрос 29).
        <WarningBanner level="danger" title={t("menu.excluded")}>
          {menu.excluded_products.map((product) => product.name_ru).join(", ")}
        </WarningBanner>
      )}

      {menu !== null && menu.withdrawn_products.length > 0 && (
        <WarningBanner level="warning" title={t("menu.withdrawn")}>
          {menu.withdrawn_products.map((product) => product.name_ru).join(", ")}
        </WarningBanner>
      )}

      {meals.map((mealIndex) => {
        const inMeal = items.filter((item) => item.meal_index === mealIndex);
        const title = t("menu.meal", { index: mealIndex });

        return (
          <Section key={mealIndex} title={title} density="compact">
            {inMeal.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">
                {t("menu.mealEmpty")}
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-field p-0">
                {inMeal.map((item) => (
                  <li key={item.id}>
                    <MealItem
                      item={item}
                      canMarkEaten={canMarkEaten}
                      pending={pendingId === item.id}
                      failed={failedId === item.id}
                      failure={failure}
                      onToggle={onToggle}
                      actions={
                        // Убрать можно только неотмеченное: съеденное — уже
                        // запись о том, что ребёнок ел. Справа и с
                        // подтверждением: промах при отметке «съедено» не
                        // должен убирать блюдо без вопроса.
                        !item.eaten && (
                          <TelegramConfirmDialog
                            trigger={
                              <RemoveButton
                                label={t("menu.compose.remove")}
                                disabled={removing}
                                aria-label={t("menu.compose.removeAria", {
                                  title: item.title ?? t("menu.unknownDish"),
                                })}
                              />
                            }
                            title={t("menu.compose.removeTitle", {
                              title: item.title ?? t("menu.unknownDish"),
                            })}
                            description={t("menu.compose.removeBody")}
                            confirmLabel={t("menu.compose.remove")}
                            cancelLabel={t("menu.compose.keep")}
                            onConfirm={() => onRemove(item)}
                          />
                        )
                      }
                    >
                      <ItemDetails item={item} onOpenRecipe={onOpenRecipe} />
                    </MealItem>
                  </li>
                ))}
              </ul>
            )}
            {canCompose && (
              <Button
                type="button"
                variant="outline"
                className="min-h-touch w-full"
                aria-label={t("menu.addToMealAria", { index: mealIndex })}
                onClick={() => onCompose(mealIndex)}
              >
                <Plus aria-hidden="true" className="size-4" />
                {t("menu.addToMeal")}
              </Button>
            )}
          </Section>
        );
      })}

      {menu !== null && (
        <DayTotals totals={menu.totals} targets={targets} verdict={verdict} />
      )}
    </div>
  );
}

/**
 * «Что взвесить» и «Как готовить» под блюдом.
 *
 * Граммы приходят с сервера уже на эту позицию (М1): доумножать их здесь
 * нечем. Раскрывается кнопкой, а не системным `<details>`: тот на телефоне
 * рисуется по-своему в каждом браузере и не держит высоту касания.
 */
function ItemDetails({
  item,
  onOpenRecipe,
}: {
  item: MenuItem;
  onOpenRecipe: (recipeId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const lines = item.ingredients ?? [];
  const recipeId = item.recipe_id;
  if (lines.length === 0 && recipeId === null) return null;

  return (
    <div className="flex flex-col gap-1 pl-8 text-sm">
      <div className="flex flex-wrap gap-x-field">
        {lines.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-touch px-2 text-muted-foreground"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {t("menu.composition")}
          </Button>
        )}
        {/* Рецепт ↔ меню в обе стороны: из меню — к тому, как готовить. */}
        {recipeId !== null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-touch px-2 text-muted-foreground"
            onClick={() => onOpenRecipe(recipeId)}
          >
            <ChefHat aria-hidden="true" className="size-4" />
            {t("menu.howToCook")}
          </Button>
        )}
      </div>
      {open && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {lines.map((line) => (
            <li
              key={line.product_id}
              className="flex flex-wrap justify-between gap-field"
            >
              <span className="min-w-0 break-words">
                {line.name_ru}
                {/* Приправу взвешивают, но в итогах дня её нет (ADR-0054). */}
                {line.counts_in_calculation === false && (
                  <span className="ml-2 text-muted-foreground">
                    {t("menu.uncounted")}
                  </span>
                )}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {t("menu.grams", { value: formatMass(line.grams) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
