import {
  AsyncSection,
  Button,
  EmptyState,
  RatioBadge,
  Section,
  WarningBanner,
  formatGrams,
  formatKcal,
} from "@ketocare/ui";
import { ArrowLeft, Calculator, ChevronRight, CookingPot } from "lucide-react";
import { useTranslation } from "react-i18next";

import { RemoveButton } from "../../components/RemoveButton";
import { TelegramConfirmDialog } from "../../components/TelegramConfirmDialog";
import { errorMessageOf } from "../../lib/api";
import { useTelegramBack } from "../../lib/useTelegram";
import { AddToPlan } from "../menu/AddToPlan";
import {
  type CustomDish,
  useCustomDishes,
  useDeleteCustomDish,
} from "../menu/useDishOptions";
import { ProductComposition } from "../recipes/ProductComposition";

/**
 * «диетолог Иванова А.» — кто рассчитал блюдо, если не семья; иначе `null`.
 *
 * Семья перезаписывала и удаляла порцию, рассчитанную диетологом, не зная, чья
 * она (аудит 26.11.2026, 1.6). У блюд, сохранённых до того, как автора стали
 * помнить, его нет — и пометки нет.
 */
export function calculatedBy(
  dish: CustomDish,
  t: (key: string) => string,
): string | null {
  const role = dish.created_by_role ?? null;
  const name = dish.created_by_name ?? null;
  if (role === null || name === null || role === "parent") return null;
  const roleWord =
    role === "dietitian" || role === "doctor"
      ? t(`dishes.card.role.${role}`)
      : t("dishes.card.role.other");
  return `${roleWord} ${name}`;
}

/**
 * Блюда ребёнка — то, что семья собрала в расчёте или завёл специалист.
 *
 * Нажатие на блюдо открывает его карточку (Б1 аудита Mini App): показатели,
 * что взвесить, как готовить, «Добавить в меню», «Открыть в расчёте» и
 * «Удалить блюдо». Прежде у строки было только «В меню»: состав и шаги
 * открыть было нельзя, ошибочное блюдо — убрать.
 *
 * Пометки «не как в назначении» здесь нет: блюдо ребёнка собирают под его
 * назначение, а сверку блюд с назначением сервер отдаёт только специалисту.
 * Считать её в приложении — второй источник клинических чисел.
 */
export function ChildDishes({
  patientId,
  openId,
  onOpenIdChange,
  onOpenCalculator,
  onOpenInCalculator,
}: {
  patientId: string;
  /**
   * Открытое блюдо. Живёт у вкладки, а не здесь: карточка рецепта открывает
   * блюдо ребёнка из соседнего раздела.
   */
  openId: string | null;
  onOpenIdChange: (dishId: string | null) => void;
  /** Пустой расчёт — из пустого списка. */
  onOpenCalculator: () => void;
  /** Состав блюда — в расчёт. */
  onOpenInCalculator: (dish: CustomDish) => void;
}) {
  const { t } = useTranslation();
  const dishes = useCustomDishes(patientId);
  const opened = dishes.data?.find((dish) => dish.id === openId) ?? null;

  // Список остаётся смонтированным под карточкой, как у рецептов: прокрутка
  // не теряется, когда человек возвращается.
  return (
    <>
      {opened !== null && (
        <DishCard
          dish={opened}
          patientId={patientId}
          onBack={() => onOpenIdChange(null)}
          onOpenInCalculator={() => onOpenInCalculator(opened)}
        />
      )}
      <section
        aria-label={t("dishes.sections.dishes")}
        hidden={opened !== null}
        className="flex flex-col gap-section"
      >
        <AsyncSection
          loading={dishes.isPending}
          skeleton={null}
          error={
            dishes.isError
              ? {
                  title: t("dishes.loadError"),
                  description:
                    errorMessageOf(dishes.error) ?? t("home.loadErrorHint"),
                }
              : null
          }
          waiting={
            dishes.fetchStatus === "paused"
              ? t("errors.waitingForNetwork")
              : null
          }
          retryLabel={t("actions.retry")}
          onRetry={() => void dishes.refetch()}
          isEmpty={dishes.data?.length === 0}
          empty={
            // Пустое состояние — заголовок и кнопка (правило 3 словаря).
            <EmptyState
              icon={CookingPot}
              title={t("dishes.empty")}
              action={
                <Button
                  type="button"
                  className="min-h-touch w-full"
                  onClick={onOpenCalculator}
                >
                  {t("dishes.openCalculator")}
                </Button>
              }
            />
          }
        >
          <ul className="m-0 flex list-none flex-col gap-field p-0">
            {(dishes.data ?? []).map((dish) => (
              <li key={dish.id}>
                <button
                  type="button"
                  className="flex min-h-touch w-full items-center gap-field rounded-xl border border-border px-3 py-2 text-left"
                  onClick={() => {
                    onOpenIdChange(dish.id);
                    window.scrollTo(0, 0);
                  }}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="break-words">{dish.title}</span>
                    {dish.computed != null && (
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {t("menu.compose.kcal", {
                          value: formatKcal(dish.computed.kcal),
                        })}
                      </span>
                    )}
                  </span>
                  <RatioBadge ratio={dish.computed?.ratio ?? null} />
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                </button>
              </li>
            ))}
          </ul>
        </AsyncSection>
      </section>
    </>
  );
}

/**
 * Карточка блюда ребёнка. Порядок — как у рецепта (М5): показатели, что
 * взвесить, как готовить, потом — куда поставить и что ещё сделать.
 *
 * Блюдо — одна порция целиком: в меню оно ставится множителем 1, и граммы
 * ниже — ровно то, что сохранено на сервере.
 */
function DishCard({
  dish,
  patientId,
  onBack,
  onOpenInCalculator,
}: {
  dish: CustomDish;
  patientId: string;
  onBack: () => void;
  onOpenInCalculator: () => void;
}) {
  const { t } = useTranslation();
  const remove = useDeleteCustomDish(patientId);
  const steps = (dish.instructions ?? "").trim();
  const computed = dish.computed;
  const author = calculatedBy(dish, t);

  // «Назад» Telegram закрывает карточку, а не весь Mini App.
  useTelegramBack(remove.isPending ? null : onBack);

  return (
    <section
      aria-labelledby={`dish-${dish.id}`}
      className="flex flex-col gap-section"
    >
      <Button
        variant="ghost"
        className="min-h-touch self-start"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t("dishes.card.back")}
      </Button>

      <h2 id={`dish-${dish.id}`} className="m-0 break-words text-page-title">
        {dish.title}
      </h2>
      {author !== null && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("dishes.card.calculatedBy", { name: author })}
        </p>
      )}

      <Section title={t("dishes.card.perDish")} density="compact">
        {computed == null ? (
          <p className="m-0 text-muted-foreground">
            {t("dishes.card.notComputed")}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-field">
            <RatioBadge ratio={computed.ratio} />
            <span className="tabular-nums">
              {t("recipes.kcal", { kcal: formatKcal(computed.kcal) })}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {t("recipes.macros", {
                fat: formatGrams(computed.fat),
                protein: formatGrams(computed.protein),
                carbs: formatGrams(computed.carbs),
              })}
            </span>
          </div>
        )}
      </Section>

      <Section title={t("menu.composition")} density="compact">
        <DishIngredients dish={dish} />
      </Section>

      {/* Шаги у блюда необязательны (ADR-0088): без них блока нет. */}
      {steps !== "" && (
        <Section title={t("recipes.instructions")} density="compact">
          <p className="m-0 break-words whitespace-pre-line">{steps}</p>
        </Section>
      )}

      <Section title={t("dishes.toMenu")} density="compact">
        <AddToPlan
          patientId={patientId}
          dish={{ kind: "custom", id: dish.id }}
        />
      </Section>

      <div className="flex flex-col gap-field">
        {/* Поправить граммовку — в расчёте: там считает сервер. Сохранённое
            оттуда — новое блюдо, это остаётся как есть. */}
        <Button
          type="button"
          variant="outline"
          className="min-h-touch w-full"
          onClick={onOpenInCalculator}
        >
          <Calculator aria-hidden="true" className="size-4" />
          {t("dishes.card.openInCalculator")}
        </Button>

        <TelegramConfirmDialog
          trigger={
            <RemoveButton
              label={t("dishes.card.delete")}
              disabled={remove.isPending}
              className="self-start"
            />
          }
          title={t("dishes.card.deleteTitle", { title: dish.title })}
          description={
            author === null
              ? t("dishes.card.deleteBody")
              : `${t("dishes.card.deleteBySpecialist", { name: author })} ${t("dishes.card.deleteBody")}`
          }
          confirmLabel={t("dishes.card.delete")}
          cancelLabel={t("dishes.card.keep")}
          destructive
          onConfirm={() => remove.mutate(dish.id, { onSuccess: onBack })}
        />
        {remove.isError && (
          <WarningBanner level="danger" title={t("dishes.card.deleteFailed")}>
            {errorMessageOf(remove.error) ?? t("home.loadErrorHint")}
          </WarningBanner>
        )}
      </div>
    </section>
  );
}

/**
 * Что взвесить — состав блюда граммами, как он сохранён на сервере. Тот же
 * блок, что у рецепта: продукт из архива назван и здесь (по блюду готовят так
 * же, как по рецепту).
 */
function DishIngredients({ dish }: { dish: CustomDish }) {
  return (
    <ProductComposition
      ingredients={dish.ingredients}
      uncountedIds={dish.computed?.uncounted_product_ids ?? []}
    />
  );
}
