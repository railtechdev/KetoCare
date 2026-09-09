import { Button, EmptyState, Input, cn } from "@ketocare/ui";
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
            </div>

            {/* Вклад позиции. Пока пересчёт не догнал правку, числа гаснут
                вместе с итогом блюда — но остаются: гасить их совсем значит
                очищать строку, по которой человек и правит граммовку. */}
            {contribution !== undefined && (
              <div
                role="group"
                aria-label={t("contribution.label", { name: row.product.name })}
                aria-busy={stale}
                className={cn(
                  "grid grid-cols-4 gap-x-3 text-sm tabular-nums text-muted-foreground",
                  stale && "opacity-60 transition-opacity",
                )}
              >
                <ContributionCell
                  short={t("contribution.kcal")}
                  full={t("contribution.kcalFull")}
                  value={contribution.kcal.toFixed(0)}
                  unitAfter
                />
                <ContributionCell
                  short={t("contribution.fat")}
                  full={t("contribution.fatFull")}
                  value={contribution.fat_g.toFixed(1)}
                />
                <ContributionCell
                  short={t("contribution.protein")}
                  full={t("contribution.proteinFull")}
                  value={contribution.protein_g.toFixed(1)}
                />
                <ContributionCell
                  short={t("contribution.carbs")}
                  full={t("contribution.carbsFull")}
                  value={contribution.carbs_g.toFixed(1)}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Одна ячейка вклада: подпись и число в одной строке.
 *
 * Глазу — сокращение из подсказки поиска («Ж», «Б», «У»): на 360 px четыре
 * полных слова в строку не встают. Единица калорий стоит ПОСЛЕ числа
 * («367 ккал»), как в подсказке и в итоге блюда, — а не перед ним, как буква
 * макронутриента. Вспомогательной технологии — полное название, иначе строка
 * читается как набор букв.
 */
function ContributionCell({
  short,
  full,
  value,
  unitAfter = false,
}: {
  short: string;
  full: string;
  value: string;
  unitAfter?: boolean;
}) {
  const label = (
    <span aria-hidden="true" className="shrink-0">
      {short}
    </span>
  );
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="sr-only">{full}</span>
      {!unitAfter && label}
      <span className="text-foreground">{value}</span>
      {unitAfter && label}
    </span>
  );
}
