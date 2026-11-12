import { FormSheet, toast } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { ProductForm } from "../admin/ProductForm";
import {
  EMPTY_PRODUCT_FORM_VALUES,
  toProductCreateBody,
} from "../admin/productSchemas";
import {
  useCreateProductMutation,
  useProductCategories,
} from "../admin/useAdminProducts";
import type { Product } from "../admin/types";
import type { ProductOption } from "./useProducts";

/**
 * Новый продукт справочника — панелью на том же экране.
 *
 * Не нашедший продукт уходил в справочник и терял начатый состав. Форма та же,
 * что в справочнике (`ProductForm`), а не копия: проверка значений, единицы и
 * обязательные поля не должны зависеть от того, откуда продукт заводят.
 * Заводить продукты вправе врач, диетолог и администратор (ADR-0057); право
 * проверяет сервер.
 */
export function NewProductSheet({
  open,
  name,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  /** Что искали: с этого названия форма и начинается. */
  name: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (product: ProductOption) => void;
}) {
  const { t } = useTranslation("calculator");
  const categories = useProductCategories();
  const create = useCreateProductMutation();

  return (
    <FormSheet
      closeLabel={t("common:actions.close")}
      open={open}
      onOpenChange={(next) => {
        if (!next) create.reset();
        onOpenChange(next);
      }}
      title={t("newProduct.title")}
      description={t("newProduct.description")}
    >
      {open && (
        <ProductForm
          mode="create"
          defaultValues={{ ...EMPTY_PRODUCT_FORM_VALUES, nameRu: name }}
          categories={categories.data ?? []}
          pending={create.isPending}
          error={create.error}
          onCancel={() => onOpenChange(false)}
          onSubmit={(values) =>
            create.mutate(toProductCreateBody(values), {
              onSuccess: (product) => {
                toast.success(t("newProduct.added", { name: product.name_ru }));
                onCreated(toOption(product));
                onOpenChange(false);
              },
            })
          }
        />
      )}
    </FormSheet>
  );
}

function toOption(product: Product): ProductOption {
  return {
    id: product.id,
    name: product.name_ru,
    kcal: product.kcal_100g,
    fat: product.fat_100g,
    protein: product.protein_100g,
    carbs: product.carbs_100g,
    fiber: product.fiber_100g,
    isActive: product.is_active,
  };
}
