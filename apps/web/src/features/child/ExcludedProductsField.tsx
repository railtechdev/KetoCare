import { Button } from "@ketocare/ui";
import { X } from "lucide-react";
import { useId } from "react";
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

  const hintId = useId();

  const names = new Map<string, string | null>(
    known.map((entry) => [entry.id, entry.name_ru ?? null]),
  );

  // Группа с общей подписью — `fieldset` с `legend` (правило П23 оставляет его
  // ровно для такого случая): поиск продукта и список выбранного — одно поле,
  // а подпись абзацем программа чтения экрана с ними не связывала.
  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-field border-0 p-0"
      aria-describedby={hintId}
    >
      <legend className="mb-field p-0 text-sm font-medium">
        {t("child.fields.excluded")}
      </legend>
      <p id={hintId} className="m-0 text-sm text-muted-foreground">
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
              <ExcludedChip
                id={id}
                name={names.get(id) ?? null}
                onRemove={() => onChange(value.filter((it) => it !== id))}
              />
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/**
 * Исключённый продукт и кнопка «убрать».
 *
 * Название приходит вместе с карточкой ребёнка, но у только что выбранного его
 * нет — и у сохранённого раньше, если карточку открыли из списка. Его берёт
 * справочник, и им же подписана кнопка: прежде подпись подставляла
 * идентификатор, и программа чтения экрана зачитывала «Убрать из исключений:
 * 3f2a…». Идентификатор не показывается нигде: список исключённого читают,
 * решая, чем кормить ребёнка.
 */
function ExcludedChip({
  id,
  name,
  onRemove,
}: {
  id: string;
  name: string | null;
  onRemove: () => void;
}) {
  const { t } = useTranslation("child");
  const product = useProduct(name === null ? id : undefined);

  const resolved =
    name ??
    product.data?.name ??
    (product.isError ? t("child.fields.excludedUnknown") : null);

  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm">
      {resolved === null ? (
        <span className="text-muted-foreground">…</span>
      ) : product.isError && name === null ? (
        <span className="text-muted-foreground">{resolved}</span>
      ) : (
        resolved
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="min-h-touch min-w-touch text-muted-foreground"
        aria-label={
          resolved === null
            ? t("child.fields.excludedRemoveLoading")
            : t("child.fields.excludedRemove", { name: resolved })
        }
        onClick={onRemove}
      >
        <X aria-hidden="true" />
      </Button>
    </span>
  );
}
