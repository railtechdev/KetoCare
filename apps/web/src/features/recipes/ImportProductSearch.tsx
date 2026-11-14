import { Button } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { ProductPicker } from "../calculator/ProductPicker";

/** Из поиска ничего не исключается: одно название — один продукт. */
const NO_PRODUCTS: string[] = [];

/**
 * Поиск продукта справочника для названия из файла.
 *
 * Один на список названий и на состав рецепта: продукт выбирают там, где
 * заметили, что его нет, а решение в обоих местах одно — по названию.
 */
export function ImportProductSearch({
  onPick,
  onCancel,
}: {
  onPick: (productId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("recipes");

  return (
    <div className="flex max-w-xl flex-col gap-2">
      <ProductPicker
        excludeIds={NO_PRODUCTS}
        onPick={(product) => onPick(product.id)}
      />
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("importDraft.names.cancel")}
        </Button>
      </div>
    </div>
  );
}
