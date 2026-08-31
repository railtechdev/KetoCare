import { Button } from "@ketocare/ui";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ProductForm } from "./ProductForm";
import { ProductRevisions } from "./ProductRevisions";
import {
  EMPTY_PRODUCT_FORM_VALUES,
  toProductCreateBody,
  toProductFormValues,
  toProductUpdateBody,
} from "./productSchemas";
import {
  useCreateProductMutation,
  useUpdateProductMutation,
} from "./useAdminProducts";
import type { Product, ProductCategory } from "./types";

interface Props {
  /** `null` — заведение новой позиции */
  product: Product | null;
  categories: readonly ProductCategory[];
  /** Сохранённая позиция — возвращается, чтобы список подтвердил, что записано */
  onSaved: (product: Product) => void;
  onCancel: () => void;
  /**
   * Показывать историю правок. Она читается из `/admin/audit-log`, а он закрыт
   * ролью admin: диетологу этот блок дал бы 403 вместо содержимого. Показывать
   * неработающее — хуже, чем не показывать (правило П3 канона).
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
  onSaved,
  onCancel,
  showHistory = true,
}: Props) {
  const { t } = useTranslation("admin");

  const create = useCreateProductMutation();
  const update = useUpdateProductMutation(product?.id ?? null);

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

      <ProductForm
        mode={product === null ? "create" : "edit"}
        defaultValues={
          product === null
            ? EMPTY_PRODUCT_FORM_VALUES
            : toProductFormValues(product)
        }
        categories={categories}
        pending={create.isPending || update.isPending}
        error={create.error ?? update.error}
        onCancel={onCancel}
        onSubmit={(values) => {
          if (product === null) {
            create.mutate(toProductCreateBody(values), { onSuccess: onSaved });
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
