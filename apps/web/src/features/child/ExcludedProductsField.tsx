import { Button } from "@ketocare/ui";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ProductPicker } from "../calculator/ProductPicker";
import { useProduct } from "../calculator/useProducts";

interface Known {
  id: string;
  name_ru?: string | null;
}

/**
 * Что ребёнку нельзя — ссылками на каталог.
 *
 * Свободная строка «арахис, орехи» сопоставима только с глазами человека: ни
 * подбор раскладки, ни составление меню о ней не узнают, и ребёнку с аллергией
 * на арахис решатель предложит арахисовое масло (раздел 6.3 ТЗ). Поэтому
 * конкретный продукт выбирается из справочника, а свободные метки — то, что
 * продуктом не выражается («орехи вообще»), — остаются отдельным полем.
 */
export function ExcludedProductsField({
  value,
  onChange,
  known,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Названия уже сохранённых исключений — из карточки ребёнка */
  known: readonly Known[];
}) {
  const { t } = useTranslation("child");

  const names = new Map<string, string | null>(
    known.map((entry) => [entry.id, entry.name_ru ?? null]),
  );

  return (
    <div className="flex flex-col gap-field">
      <p className="m-0 text-sm font-medium">{t("child.fields.excluded")}</p>
      <p className="m-0 text-sm text-muted-foreground">
        {t("child.fields.excludedHint")}
      </p>

      <ProductPicker
        excludeIds={value}
        onPick={(product) => {
          names.set(product.id, product.name);
          onChange([...value, product.id]);
        }}
      />

      {value.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-field p-0">
          {value.map((id) => (
            <li key={id}>
              <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm">
                <ExcludedName id={id} name={names.get(id) ?? null} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="min-h-touch min-w-touch text-muted-foreground"
                  aria-label={t("child.fields.excludedRemove", {
                    name: names.get(id) ?? id,
                  })}
                  onClick={() => onChange(value.filter((it) => it !== id))}
                >
                  <X aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Название исключённого продукта.
 *
 * Приходит вместе с карточкой ребёнка, но у только что выбранного его нет — и
 * у сохранённого раньше, если карточку открыли из списка. Идентификатор
 * показывать нельзя: список исключённого читают, решая, чем кормить ребёнка.
 */
function ExcludedName({ id, name }: { id: string; name: string | null }) {
  const { t } = useTranslation("child");
  const product = useProduct(name === null ? id : undefined);

  if (name !== null) return <>{name}</>;
  if (product.data) return <>{product.data.name}</>;
  return (
    <span className="text-muted-foreground">
      {product.isError ? t("child.fields.excludedUnknown") : "…"}
    </span>
  );
}
