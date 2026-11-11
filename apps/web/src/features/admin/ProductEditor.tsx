import { Button, WarningBanner } from "@ketocare/ui";
import { ArrowLeft } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { SelectField } from "../../components/Field";
import {
  DEFAULT_FOOD_STANDARD_ID,
  type FoodStandard,
} from "../standards/useFoodStandards";

import { ProductForm } from "./ProductForm";
import { ProductRevisions } from "../products/ProductRevisions";
import {
  confirmedFields,
  EMPTY_PRODUCT_FORM_VALUES,
  toProductCreateBody,
  toProductFormValues,
  toProductUpdateBody,
  unknownNutrients,
} from "./productSchemas";
import {
  useCreateProductMutation,
  useDeriveProductMutation,
  useUpdateProductMutation,
} from "./useAdminProducts";
import type { Product, ProductCategory } from "./types";

interface Props {
  /** `null` — заведение новой позиции */
  product: Product | null;
  categories: readonly ProductCategory[];
  /** Все стандарты: по ним видно, закрыта ли запись и куда положить копию */
  standards: readonly FoodStandard[];
  /** Куда заводится новая позиция; не задан — основной стандарт */
  standardId?: string;
  /** Сохранённая позиция — возвращается, чтобы список подтвердил, что записано */
  onSaved: (product: Product) => void;
  onCancel: () => void;
  /**
   * Показывать историю правок.
   *
   * Раньше она читалась из `/admin/audit-log`, закрытого ролью admin, и
   * диетологу этот блок дал бы 403 вместо содержимого. Теперь история берётся
   * из `product_revisions` — настоящей истории позиции, открытой и диетологу
   * тоже, — и признак остаётся ради одного: у новой позиции истории нет, а
   * пустой блок в форме заведения ни о чём не говорит.
   */
  showHistory?: boolean;
}

/**
 * Карточка позиции справочника: форма и история её ревизий рядом.
 *
 * История показывается только у существующей позиции — у новой её ещё нет.
 *
 * Возврат оформлен так же, как в шапке `PageLayout`: у карточки нет своего
 * URL — она живёт состоянием внутри вкладки, — поэтому шаблон экрана
 * подставить сюда нечего, но паттерн возврата остаётся один (правило П2).
 */
export function ProductEditor({
  product,
  categories,
  standards,
  standardId,
  onSaved,
  onCancel,
  showHistory = true,
}: Props) {
  const { t } = useTranslation("admin");

  const create = useCreateProductMutation();
  const update = useUpdateProductMutation(product?.id ?? null);
  const derive = useDeriveProductMutation(product?.id ?? null);
  const ids = useId();
  const [target, setTarget] = useState(DEFAULT_FOOD_STANDARD_ID);

  // Запись закрытого стандарта не правится: та же форма создаёт её копию.
  const deriving =
    product !== null &&
    standards.some(
      (standard) =>
        standard.id === product.standard_id && standard.locked_at != null,
    );
  const generalOrigin = standards.some(
    (standard) =>
      standard.id === product?.standard_id && standard.diet_type === "general",
  );
  const targets = standards.filter(
    (standard) =>
      standard.kind === "clinic" &&
      standard.locked_at == null &&
      standard.is_active,
  );

  return (
    <div className="flex flex-col gap-screen">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 self-start"
        onClick={onCancel}
      >
        <ArrowLeft aria-hidden="true" />
        {t("products.backToList")}
      </Button>

      {deriving && targets.length > 1 && (
        <SelectField
          id={`${ids}-target`}
          width="wide"
          label={t("products.form.deriveTarget")}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          {targets.map((standard) => (
            <option key={standard.id} value={standard.id}>
              {standard.name}
            </option>
          ))}
        </SelectField>
      )}

      {deriving && generalOrigin && target === DEFAULT_FOOD_STANDARD_ID && (
        <WarningBanner
          level="warning"
          title={t("products.form.deriveGeneralTitle")}
        >
          {t("products.form.deriveGeneralBody")}
        </WarningBanner>
      )}

      <ProductForm
        mode={deriving ? "derive" : product === null ? "create" : "edit"}
        defaultValues={
          product === null
            ? EMPTY_PRODUCT_FORM_VALUES
            : toProductFormValues(product)
        }
        categories={categories}
        unknownNutrients={unknownNutrients(product)}
        pending={create.isPending || update.isPending || derive.isPending}
        error={create.error ?? update.error ?? derive.error}
        onCancel={onCancel}
        onSubmit={(values) => {
          if (product === null) {
            create.mutate(
              { ...toProductCreateBody(values), standard_id: standardId },
              { onSuccess: onSaved },
            );
          } else if (deriving) {
            derive.mutate(
              {
                ...toProductCreateBody(values),
                standard_id: target,
                confirmed_fields: confirmedFields(values),
              },
              { onSuccess: onSaved },
            );
          } else {
            update.mutate(toProductUpdateBody(values), { onSuccess: onSaved });
          }
        }}
      />

      {showHistory && product !== null && (
        <ProductRevisions productId={product.id} />
      )}
    </div>
  );
}
