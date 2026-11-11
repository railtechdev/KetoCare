import {
  AsyncSection,
  Button,
  ConfirmDialog,
  EmptyState,
  FormFooter,
  FormSheet,
  RatioBadge,
  Section,
  formatKcal,
  formatRatio,
  toast,
} from "@ketocare/ui";
import {
  CalendarPlus,
  Calculator,
  CookingPot,
  Pencil,
  Trash2,
  Utensils,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { SectionLink } from "../../components/SectionLink";
import { PatientViewLink } from "../doctor/PatientViewLink";
import { incomingDish } from "../calculator/incomingItem";
import { errorMessageOf } from "../../lib/api";
import {
  useCustomDishes,
  useDeleteCustomDish,
  useDishReview,
  useRenameCustomDish,
  type CustomDish,
  type DishReview,
} from "./useCustomDishes";
import { queryState } from "../../lib/queryState";
import { RecipeFitSheet } from "./RecipeFitSheet";

/**
 * Блюда ребёнка — раскладки, сохранённые из калькулятора.
 *
 * Форма сохранения обещала список — списка не существовало нигде. Блюдо с
 * ошибкой в названии или составе оставалось в подсказках меню навсегда, и
 * посмотреть, что в нём, было нельзя.
 *
 * Состав здесь только показывается. Править его — работа калькулятора: он
 * считает по ядру и умеет подбирать массы, а форма списка считала бы сама, то
 * есть завела бы второй источник клинических чисел.
 *
 * Список один на два места, и `openIn` говорит, КУДА он ведёт. У семьи
 * калькулятор — раздел кабинета; в карте пациента он раздел карты, и только
 * там у расчёта есть кетосоотношение из назначения и исключённые продукты.
 * Ссылка на общий калькулятор из карты вела бы в экран, который про этого
 * ребёнка ничего не знает и его блюда открыть не может.
 */
export function MyDishesPanel({
  patientId,
  openIn = "section",
}: {
  patientId: string | null;
  openIn?: "section" | "card";
}) {
  const { t } = useTranslation("recipes");
  const inCard = openIn === "card";
  const dishes = useCustomDishes(patientId);
  // Цель есть только у специалиста в карте: семье сервер этого не отдаёт.
  const review = useDishReview(inCard ? patientId : null);
  const offTarget = new Set(
    (review.data?.off_target ?? []).map((item) => item.dish_id),
  );
  const [renaming, setRenaming] = useState<CustomDish | null>(null);

  const rename = useRenameCustomDish(patientId ?? "");
  const remove = useDeleteCustomDish(patientId ?? "");

  return (
    // «Мои блюда» — надпись от первого лица, и в чужой карте она называет не
    // того: блюда здесь принадлежат ребёнку, а читает их специалист.
    <Section
      title={t(inCard ? "myDishes.patientTitle" : "myDishes.title")}
      description={t(inCard ? "myDishes.patientIntro" : "myDishes.intro")}
    >
      {inCard && patientId !== null && (
        <div className="flex flex-wrap gap-field">
          <Button asChild className="min-h-touch">
            <PatientViewLink patientId={patientId} view="calculator">
              <Plus aria-hidden="true" />
              {t("myDishes.new")}
            </PatientViewLink>
          </Button>
          <RecipeFitSheet patientId={patientId} />
        </div>
      )}

      {inCard && patientId !== null && review.data !== undefined && (
        <OffTargetNotice patientId={patientId} review={review.data} />
      )}

      <AsyncSection
        {...queryState(dishes)}
        skeleton={null}
        error={
          dishes.isError
            ? {
                title: t("myDishes.errorTitle"),
                description:
                  errorMessageOf(dishes.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void dishes.refetch()}
        isEmpty={(dishes.data ?? []).length === 0}
        empty={
          <EmptyState
            icon={CookingPot}
            title={t("myDishes.empty")}
            description={t("myDishes.emptyDescription")}
          />
        }
      >
        <ul className="m-0 flex list-none flex-col gap-section p-0">
          {(dishes.data ?? []).map((dish) => (
            <li
              key={dish.id}
              className="flex flex-wrap items-center gap-field rounded-xl border border-border p-3"
            >
              <span className="flex-1 font-semibold">{dish.title}</span>

              {offTarget.has(dish.id) && (
                <span className="text-sm text-warning-strong">
                  {t("myDishes.offTargetMark")}
                </span>
              )}

              {dish.computed !== null && (
                <>
                  <RatioBadge ratio={dish.computed.ratio} />
                  <span className="text-muted-foreground tabular-nums">
                    {t("myDishes.kcal", {
                      value: formatKcal(dish.computed.kcal),
                    })}
                  </span>
                </>
              )}

              <span className="text-muted-foreground">
                {t("myDishes.ingredients", { count: dish.ingredients.length })}
              </span>

              {/* Своё блюдо тоже уходит в калькулятор: править состав здесь
                  нечем и не нужно — считает ядро, а не форма списка. */}
              {/* `asChild`: `data-size` до `<a>` не доходит — ссылка принимает
                  закрытый список пропов, — а с ним и тач-ширина из темы.
                  Поэтому здесь она классом. */}
              <Button asChild variant="ghost" size="sm" className="min-h-touch">
                {openIn === "card" && patientId !== null ? (
                  <PatientViewLink
                    patientId={patientId}
                    view="calculator"
                    item={incomingDish(dish.id)}
                    aria-label={t("myDishes.toCalculator", {
                      title: dish.title,
                    })}
                  >
                    <Calculator aria-hidden="true" className="size-4" />
                    <span>{t("myDishes.short.edit")}</span>
                  </PatientViewLink>
                ) : (
                  <SectionLink
                    section="calculator"
                    item={incomingDish(dish.id)}
                    aria-label={t("myDishes.toCalculator", {
                      title: dish.title,
                    })}
                  >
                    <Calculator aria-hidden="true" className="size-4" />
                    <span>{t("myDishes.short.edit")}</span>
                  </SectionLink>
                )}
              </Button>

              {openIn !== "card" && (
                <>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="min-h-touch"
                  >
                    <SectionLink
                      section="menu"
                      aria-label={t("myDishes.toMenu", { title: dish.title })}
                      title={t("myDishes.toMenu", { title: dish.title })}
                    >
                      <CalendarPlus aria-hidden="true" className="size-4" />
                      <span>{t("myDishes.short.menu")}</span>
                    </SectionLink>
                  </Button>

                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="min-h-touch"
                  >
                    <SectionLink
                      section="diary"
                      diaryKind="meals"
                      item="new"
                      aria-label={t("myDishes.eaten", { title: dish.title })}
                      title={t("myDishes.eaten", { title: dish.title })}
                    >
                      <Utensils aria-hidden="true" className="size-4" />
                      <span>{t("myDishes.short.eaten")}</span>
                    </SectionLink>
                  </Button>
                </>
              )}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("myDishes.rename", { title: dish.title })}
                onClick={() => setRenaming(dish)}
              >
                <Pencil aria-hidden="true" className="size-4" />
                <span>{t("myDishes.short.rename")}</span>
              </Button>
              <ConfirmDialog
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t("myDishes.delete", { title: dish.title })}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    <span>{t("myDishes.short.delete")}</span>
                  </Button>
                }
                // Заголовок называет объект: «Удалить?» без имени — это
                // подтверждение вслепую (правило канона).
                title={t("myDishes.confirmTitle", { title: dish.title })}
                description={t("myDishes.confirmDescription")}
                confirmLabel={t("common:actions.delete")}
                cancelLabel={t("common:actions.cancel")}
                destructive
                onConfirm={() => {
                  remove.mutate(dish.id, {
                    onSuccess: () => toast.success(t("myDishes.deleted")),
                    // Отказ, в том числе без сети (ADR-0034), не проходит молча:
                    // иначе блюдо остаётся в списке без единого слова почему.
                    onError: (error) =>
                      toast.error(
                        errorMessageOf(error) ?? t("common:errors.unexpected"),
                      ),
                  });
                }}
              />
            </li>
          ))}
        </ul>
      </AsyncSection>

      <FormSheet
        closeLabel={t("common:actions.close")}
        open={renaming !== null}
        onOpenChange={(open) => (open ? undefined : setRenaming(null))}
        title={t("myDishes.renameTitle")}
      >
        {renaming !== null && (
          <RenameForm
            dish={renaming}
            pending={rename.isPending}
            error={
              rename.isError
                ? (errorMessageOf(rename.error) ??
                  t("common:errors.unexpected"))
                : null
            }
            onCancel={() => setRenaming(null)}
            onSubmit={(title) => {
              rename.mutate(
                { dish: renaming, title },
                {
                  onSuccess: () => {
                    toast.success(t("myDishes.renamed"));
                    setRenaming(null);
                  },
                },
              );
            }}
          />
        )}
      </FormSheet>
    </Section>
  );
}

/**
 * Сколько блюд разошлось с назначением и с какого начать. Подгоняются по
 * одному в калькуляторе: подобранные граммы проверяет человек, а исправленное
 * блюдо уходит из этого списка.
 */
function OffTargetNotice({
  patientId,
  review,
}: {
  patientId: string;
  review: DishReview;
}) {
  const { t } = useTranslation("recipes");
  const first = review.off_target[0];
  if (
    first === undefined ||
    review.target_ratio == null ||
    review.target_kcal == null
  ) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-warning bg-warning/10 p-3">
      <p className="m-0">
        {t("myDishes.offTarget", {
          count: review.off_target.length,
          ratio: formatRatio(review.target_ratio),
          kcal: formatKcal(review.target_kcal),
        })}
      </p>
      <PatientViewLink
        patientId={patientId}
        view="calculator"
        item={incomingDish(first.dish_id)}
        className="font-medium underline"
      >
        {t("myDishes.offTargetNext", { title: first.title })}
      </PatientViewLink>
    </div>
  );
}

function RenameForm({
  dish,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  dish: CustomDish;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}) {
  const { t } = useTranslation("recipes");
  const [title, setTitle] = useState(dish.title);
  const trimmed = title.trim();

  return (
    <form
      noValidate
      className="flex flex-col gap-section"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed !== "") onSubmit(trimmed);
      }}
    >
      <Field
        id={`rename-${dish.id}`}
        label={t("myDishes.titleLabel")}
        error={trimmed === "" ? t("myDishes.titleRequired") : undefined}
        value={title}
        maxLength={255}
        onChange={(event) => setTitle(event.target.value)}
      />

      {error !== null && <p className="text-destructive">{error}</p>}

      <FormFooter
        submitLabel={t("common:actions.save")}
        pendingLabel={t("common:actions.saving")}
        pending={pending}
        onCancel={onCancel}
        cancelLabel={t("common:actions.cancel")}
      />
    </form>
  );
}
