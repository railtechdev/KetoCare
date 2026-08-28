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
}

/**
 * Карточка позиции справочника: форма и история её ревизий рядом.
 *
 * История показывается только у существующей позиции — у новой её ещё нет.
 */
export function ProductEditor({
  product,
  categories,
  onSaved,
  onCancel,
}: Props) {
  const { t } = useTranslation("admin");

  const create = useCreateProductMutation();
  const update = useUpdateProductMutation(product?.id ?? null);

  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        onClick={onCancel}
        className="min-h-touch self-start rounded-lg border border-border px-4 text-foreground"
      >
        {t("products.backToList")}
      </button>

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

      {product !== null && <ProductRevisions productId={product.id} />}
    </div>
  );
}
