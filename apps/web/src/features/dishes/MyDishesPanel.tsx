import {
  AsyncSection,
  Button,
  ConfirmDialog,
  EmptyState,
  FormFooter,
  FormSheet,
  RatioBadge,
  Section,
  toast,
} from "@ketocare/ui";
import { Calculator, CookingPot, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { SectionLink } from "../../components/SectionLink";
import { incomingDish } from "../calculator/incomingDish";
import { errorMessageOf } from "../../lib/api";
import {
  useCustomDishes,
  useDeleteCustomDish,
  useRenameCustomDish,
  type CustomDish,
} from "./useCustomDishes";

/**
 * «Мои блюда» — раскладки, сохранённые семьёй из калькулятора.
 *
 * Форма сохранения обещала список — списка не существовало нигде. Блюдо с
 * ошибкой в названии или составе оставалось в подсказках меню навсегда, и
 * посмотреть, что в нём, было нельзя.
 *
 * Состав здесь только показывается. Править его — работа калькулятора: он
 * считает по ядру и умеет подбирать массы, а форма списка считала бы сама, то
 * есть завела бы второй источник клинических чисел.
 */
export function MyDishesPanel({ patientId }: { patientId: string | null }) {
  const { t } = useTranslation("recipes");
  const dishes = useCustomDishes(patientId);
  const [renaming, setRenaming] = useState<CustomDish | null>(null);

  const rename = useRenameCustomDish(patientId ?? "");
  const remove = useDeleteCustomDish(patientId ?? "");

  return (
    <Section title={t("myDishes.title")} description={t("myDishes.intro")}>
      <AsyncSection
        loading={dishes.isPending && patientId !== null}
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
        <ul className="m-0 flex list-none flex-col gap-block p-0">
          {(dishes.data ?? []).map((dish) => (
            <li
              key={dish.id}
              className="flex flex-wrap items-center gap-field rounded-xl border border-border p-3"
            >
              <span className="flex-1 font-semibold">{dish.title}</span>

              {dish.computed !== null && (
                <>
                  <RatioBadge ratio={dish.computed.ratio} />
                  <span className="text-muted-foreground tabular-nums">
                    {t("myDishes.kcal", {
                      value: dish.computed.kcal.toFixed(0),
                    })}
                  </span>
                </>
              )}

              <span className="text-muted-foreground">
                {t("myDishes.ingredients", { count: dish.ingredients.length })}
              </span>

              {/* Своё блюдо тоже уходит в калькулятор: править состав здесь
                  нечем и не нужно — считает ядро, а не форма списка. */}
              <Button asChild variant="ghost" size="icon">
                <SectionLink
                  section="calculator"
                  tab="scale"
                  item={incomingDish(dish.id)}
                  aria-label={t("myDishes.toCalculator", { title: dish.title })}
                >
                  <Calculator aria-hidden="true" className="size-4" />
                </SectionLink>
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("myDishes.rename", { title: dish.title })}
                onClick={() => setRenaming(dish)}
              >
                <Pencil aria-hidden="true" className="size-4" />
              </Button>
              <ConfirmDialog
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("myDishes.delete", { title: dish.title })}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
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
                  });
                }}
              />
            </li>
          ))}
        </ul>
      </AsyncSection>

      <FormSheet
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
      className="flex flex-col gap-block"
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
