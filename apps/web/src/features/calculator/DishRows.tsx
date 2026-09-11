import {
  Button,
  CALC_GRAMS_MAX,
  EmptyState,
  Input,
  MacroFacts,
  cn,
  exceedsCalcGrams,
} from "@ketocare/ui";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { DishRow, ItemContribution } from "./types";

interface Props {
  rows: DishRow[];
  /** Не передаются, когда состав только показывается: расчёт сервера не правят */
  onChangeGrams?: (productId: string, grams: number) => void;
  onRemove?: (productId: string) => void;
  /** Массы задаёт сервер — поля только для чтения */
  readOnlyGrams?: boolean;
  /**
   * Вклад каждой позиции по идентификатору продукта — из последнего ответа
   * сервера. Позиции без записи ещё не считались: строка молчит, а не
   * показывает нули.
   */
  contributions?: ReadonlyMap<string, ItemContribution>;
  /** Показанный вклад посчитан не по тому, что сейчас в полях */
  stale?: boolean;
}

/**
 * Состав блюда: продукт, масса, удаление — и вклад каждой позиции.
 *
 * Вклад стоит в строке ради одного вопроса: «что менять, когда блюдо мимо
 * цели». По итогам блюда этого не видно — видно только, что мимо. В кабинете,
 * к которому привыкла клиника (`docs/AUDIT_KDC.md`), у каждой строки стоят
 * жир, белок, углеводы и калории, и граммовку доводят, глядя на них.
 *
 * Числа стоят четырьмя ячейками одной сетки во всех строках, а не фразой:
 * фраза раскладывается по длине названия, и числа соседних строк теряют
 * общую левую линию — а сравнивают именно их. Обозначения те же, что в
 * подсказке поиска («Ж · Б · У»): одна запись на весь экран.
 */
export function DishRows({
  rows,
  onChangeGrams,
  onRemove,
  readOnlyGrams,
  contributions,
  stale = false,
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
      {rows.map((row) => {
        const contribution = contributions?.get(row.product.id);
        // Массу тяжелее предела сервер не примет. Сказать об этом обязано
        // само поле: общий отказ расчёта не называл ни поля, ни предела.
        const tooHeavy = exceedsCalcGrams(row.grams);
        const errorId = `grams-${row.product.id}-error`;

        return (
          <li
            key={row.product.id}
            className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2"
          >
            {/* basis-full у названия: на узком экране масса и удаление уезжают
                на свою строку, а длинное название не выдавливает поле за экран
                (П20). */}
            <div className="flex flex-wrap items-center gap-field">
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
                  max={CALC_GRAMS_MAX}
                  step={1}
                  readOnly={readOnlyGrams}
                  aria-invalid={tooHeavy || undefined}
                  aria-describedby={tooHeavy ? errorId : undefined}
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
            </div>

            {tooHeavy && (
              <p id={errorId} className="m-0 text-sm text-destructive">
                {t("gramsTooMuch", { max: CALC_GRAMS_MAX })}
              </p>
            )}

            {/* Вклад позиции — компонентом кита: те же числа и то же
                округление стоят в Mini App, а две копии однажды разошлись бы.
                Пока пересчёт не догнал правку, числа тускнеют вместе с итогом
                блюда, но остаются: гасить их совсем значит очищать строку, по
                которой человек и правит граммовку. */}
            {contribution !== undefined && (
              <MacroFacts
                label={t("contribution.label", { name: row.product.name })}
                kcal={contribution.kcal}
                fatG={contribution.fat_g}
                proteinG={contribution.protein_g}
                carbsG={contribution.carbs_g}
                stale={stale}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
