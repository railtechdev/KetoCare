import { Button, EmptyState, Input, cn } from "@ketocare/ui";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { DishRow } from "./types";

interface Props {
  rows: DishRow[];
  /** Не передаются, когда состав только показывается: расчёт сервера не правят */
  onChangeGrams?: (productId: string, grams: number) => void;
  onRemove?: (productId: string) => void;
  /** Массы задаёт сервер — поля только для чтения */
  readOnlyGrams?: boolean;
}

/** Состав блюда: продукт, масса, удаление. */
export function DishRows({
  rows,
  onChangeGrams,
  onRemove,
  readOnlyGrams,
}: Props) {
  const { t } = useTranslation("calculator");

  if (rows.length === 0) {
    // Строкой, а не рамкой: пустой состав — это половина экрана, о которой
    // ниже говорил ещё и блок расчёта («показатели появятся здесь»). Два
    // сообщения об одном и том же занимали 200 px и отодвигали цель вниз;
    // правило П27 канона требует одного (`size="inline"`).
    return (
      <EmptyState
        size="inline"
        title={t("empty.title")}
        description={t("empty.description")}
      />
    );
  }

  return (
    /* Своего предела ширины нет: его несёт колонка калькулятора (`max-w-form`
       в `CalculatorView`). Пока предел стоял здесь, у списка была своя правая
       линия, у полосы макронутриентов — своя, у поиска — третья; в блоке во всю
       ширину экрана масса при этом уезжала от названия продукта на 780 px. */
    <ul className="m-0 flex list-none flex-col gap-field p-0">
      {rows.map((row) => (
        <li
          key={row.product.id}
          /* basis-full у названия: на узком экране масса и удаление уезжают на
             свою строку, а длинное название не выдавливает поле за экран (П20). */
          className="flex flex-wrap items-center gap-field rounded-lg border border-border px-3 py-2"
        >
          <span className="min-w-0 flex-1 basis-full break-words sm:basis-auto">
            {row.product.name}
            {!row.product.isActive && (
              <span className="ml-2 text-sm text-warning">
                {t("withdrawn")}
              </span>
            )}
          </span>

          <div className="flex items-center gap-field sm:ml-auto">
            <label className="sr-only" htmlFor={`grams-${row.product.id}`}>
              {t("gramsFor", { name: row.product.name })}
            </label>
            <Input
              id={`grams-${row.product.id}`}
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              readOnly={readOnlyGrams}
              value={Number.isFinite(row.grams) ? row.grams : ""}
              onChange={(event) =>
                onChangeGrams?.(row.product.id, Number(event.target.value))
              }
              className={cn(
                "min-h-touch w-24 text-right tabular-nums",
                "read-only:bg-muted read-only:text-muted-foreground",
              )}
            />
            <span className="text-sm text-muted-foreground">
              {t("gramsUnit")}
            </span>

            {/* Кнопки удаления нет, когда состав только показывается:
                расчёт сервера правят не здесь, а изменением ввода выше. */}
            {onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemove(row.product.id)}
                aria-label={t("removeProduct", { name: row.product.name })}
                className="min-h-touch min-w-touch shrink-0"
              >
                <X aria-hidden="true" />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
