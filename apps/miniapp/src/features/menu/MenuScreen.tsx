import {
  AsyncSection,
  Button,
  Section,
  WarningBanner,
  dayIsOpen,
  formatDayTime,
} from "@ketocare/ui";
import { ArrowLeft, Plus, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ExternalLink } from "../../components/ExternalLink";
import { RemoveButton } from "../../components/RemoveButton";
import { TelegramConfirmDialog } from "../../components/TelegramConfirmDialog";
import { errorMessageOf } from "../../lib/api";
import { useTelegramBack } from "../../lib/useTelegram";
import { RecipeCard } from "../recipes/RecipesScreen";
import type { Session } from "../session/useSession";
import { ComposePanel, type ComposeChoice } from "./ComposePanel";
import { DayStrip } from "./DayStrip";
import { DayTotals, type DayTargets, type DayVerdictInput } from "./DayTotals";
import {
  copiedDay,
  itemsOf,
  mealNumbers,
  mealsOfDay,
  withDish,
  withoutItem,
} from "./dayPlan";
import { ItemDetails } from "./ItemDetails";
import { MealItem } from "./MealItem";
import {
  MENU_DAYS,
  WEEK_START_OFFSET,
  clampMenuDay,
  copyLabelKey,
  dayName,
  menuDatesOf,
} from "./planDays";
import { ShoppingScreen } from "./ShoppingScreen";
import { MenuProductWarnings } from "./MenuProductWarnings";
import { StaleItemNote } from "./StaleItemNote";
import type { Menu, MenuItem } from "./useMenu";
import {
  dayAt,
  isPlanChanged,
  useDayPrescription,
  useMarkEaten,
  useMenu,
  useMenuWeek,
} from "./useMenu";
import { useSaveMenu } from "./useSaveMenu";

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
  // Хранится СДВИГ, а не дата (`planDays.ts`): приложение, открытое в 23:58,
  // после полуночи иначе показывало бы вчерашнее меню, не подсветив ни одного
  // дня — а «собрать вечером на завтра» это ровно про то время суток.
  const [dayOffset, setDayOffset] = useState(() =>
    clampMenuDay(initialDayOffset),
  );
  const [composing, setComposing] = useState<number | null>(null);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [shopping, setShopping] = useState(false);
  const day = dayAt(dayOffset);
  // Неделя полосы — точки «меню составлено» (Р3 аудита Mini App).
  const week = useMenuWeek(session.patientId, dayAt(WEEK_START_OFFSET));
  const menuDates = menuDatesOf(week.data?.days);
  const menu = useMenu(session.patientId, day);
  const mark = useMarkEaten(session.patientId, day);
  const save = useSaveMenu(session.patientId, day);
  // Перенос дня — своей мутацией: её отказ называется у кнопки переноса, а
  // отказ добавления блюда — в панели сборки.
  const copy = useSaveMenu(session.patientId, day);
  // Число приёмов задаёт врач; без назначения раскладывать день не по чему.
  // Назначение — ЭТОГО дня: завтра может начаться новая версия (ADR-0078), и
  // сегодняшняя сводка для вчера и завтра не годится.
  const dayPrescription = useDayPrescription(session.patientId, day);
  const prescription = dayPrescription.data ?? null;
  const meals = mealNumbers(prescription?.meals_per_day ?? null);
  // Цели дня — из назначения этого дня. Пока его запрос в пути или отказал,
  // берётся то же назначение, пришедшее с меню (`GET /menus` отдаёт его за
  // этот день, ADR-0078): без цели калорийности правило «день ещё собирается»
  // не срабатывает, и на несобранном дне мелькала бы — а при отказе так и
  // оставалась — жёлтая плашка, которую Р2 убрал.
  const targetsSource = dayPrescription.isSuccess
    ? prescription
    : (menu.data?.prescription ?? null);
  const targets: DayTargets | null =
    targetsSource === null
      ? null
      : {
          kcalPerDay: targetsSource.kcal_per_day,
          carbsLimitG: targetsSource.carbs_limit_g,
          proteinG: targetsSource.protein_g,
          mealsPerDay: targetsSource.meals_per_day,
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

  // Вердикт о допуске считает сервер — за любой день и по назначению этого
  // дня — и отдаёт вместе с меню. Пока состав сохраняется или перечитывается,
  // вердикт относится к прежнему составу: лучше промолчать, чем показать чужое.
  const verdictFresh =
    menu.isSuccess && !menu.isFetching && !save.isPending && !copy.isPending;
  const verdict: DayVerdictInput = {
    otherDay: false,
    // Сегодня и впереди день ещё собирают (Р2 аудита Mini App).
    open: dayIsOpen(day, dayAt(0)),
    // Вердикт без цели калорийности не показывается вовсе: «собирается ли
    // ещё день», решается по ней, и без неё вышла бы тревога вместо строки.
    tolerance:
      verdictFresh && targets !== null ? (menu.data?.tolerance ?? null) : null,
    gap: verdictFresh ? (menu.data?.tolerance_gap ?? null) : null,
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

  if (shopping) {
    return (
      <ShoppingScreen
        patientId={session.patientId}
        onBack={() => {
          setShopping(false);
          window.scrollTo(0, 0);
        }}
      />
    );
  }

  if (recipeId !== null) {
    return (
      <RecipeCard
        recipeId={recipeId}
        patientId={session.patientId}
        backLabel={t("recipes.backToMenu")}
        fromMenu
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
          : t("menu.compose.title", { day: dayName(dayOffset, t) })}
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
          {/* Семь дней, а не календарь (`planDays.ts`). */}
          <DayStrip
            label={t("menu.day")}
            offsets={MENU_DAYS}
            value={dayOffset}
            menuDates={menuDates}
            onChange={(offset) => {
              setDayOffset(offset);
              // Отказ записи относится к дню, где её делали.
              save.reset();
              copy.reset();
            }}
          />

          {/* «Что купить» — сразу под полосой: в магазине открывают меню и
              ищут список вверху, а не за всеми приёмами и итогами дня, тремя
              экранами ниже. Список на дни вперёд, а не на выбранный день —
              поэтому он у полосы, а не в дне (Р3 аудита Mini App). */}
          <Button
            type="button"
            variant="outline"
            className="min-h-touch self-start"
            onClick={() => {
              setShopping(true);
              window.scrollTo(0, 0);
            }}
          >
            <ShoppingCart aria-hidden="true" className="size-4" />
            {t("shopping.open")}
          </Button>

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
                {dayPrescription.isError ? (
                  // Отказ — словами и с повтором, а не «Загружаем…» навсегда:
                  // собрать день без назначения нельзя, и причина должна быть
                  // видна (аудит 26.11.2026, 2.4).
                  <WarningBanner
                    level="danger"
                    title={t("calculator.plan.prescriptionFailed")}
                  >
                    <span className="flex flex-col gap-field">
                      <span>
                        {errorMessageOf(dayPrescription.error) ??
                          t("home.loadErrorHint")}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-touch self-start"
                        onClick={() => void dayPrescription.refetch()}
                      >
                        {t("actions.retry")}
                      </Button>
                    </span>
                  </WarningBanner>
                ) : !dayPrescription.isSuccess ? (
                  <p className="m-0 text-muted-foreground">
                    {dayPrescription.fetchStatus === "paused"
                      ? t("errors.waitingForNetwork")
                      : t("menu.compose.prescriptionUnknown")}
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
                        : t(copyLabelKey(dayOffset))}
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
                  patientId={session.patientId}
                  day={day}
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

function DayPlan({
  patientId,
  day,
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
  patientId: string;
  day: string;
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
  // День, который составил специалист: семья его не перестраивает (Р3 аудита
  // интерфейса 18.11.2026) — тише «Убрать» и другие слова под итогами.
  const composedBy =
    menu?.updated_by_name && menu.updated_by_role !== "parent"
      ? menu.updated_by_name
      : null;

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

      {menu !== null && <MenuProductWarnings menu={menu} />}

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
                                quiet={composedBy !== null}
                                aria-label={t("menu.compose.removeAria", {
                                  title: item.title ?? t("menu.unknownDish"),
                                })}
                              />
                            }
                            title={t("menu.compose.removeTitle", {
                              title: item.title ?? t("menu.unknownDish"),
                            })}
                            description={
                              composedBy === null
                                ? t("menu.compose.removeBody")
                                : t("menu.compose.removeBodySpecialist", {
                                    name: composedBy,
                                  })
                            }
                            confirmLabel={t("menu.compose.remove")}
                            cancelLabel={t("menu.compose.keep")}
                            onConfirm={() => onRemove(item)}
                          />
                        )
                      }
                    >
                      <StaleItemNote
                        item={item}
                        patientId={patientId}
                        day={day}
                      />
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
        <DayTotals
          totals={menu.totals}
          targets={targets}
          verdict={verdict}
          composedBy={composedBy}
        />
      )}
    </div>
  );
}
