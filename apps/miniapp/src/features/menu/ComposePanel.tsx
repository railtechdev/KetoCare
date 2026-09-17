import {
  AsyncSection,
  Button,
  Input,
  RatioBadge,
  formatKcal,
  useDebouncedValue,
} from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { type DishOption, useDishOptions } from "./useDishOptions";

/**
 * Выбор блюда и места в дне.
 *
 * Панель разворачивается на месте списка, а не всплывает поверх него: в
 * встроенном браузере Telegram модальное окно приходится держать самому —
 * возврат по системной кнопке, блокировка прокрутки под ним, фокус. Всё это
 * ломается по-разному на iOS и Android, и каждый такой слой уже однажды
 * оказывался причиной того, что приложение не открывалось.
 *
 * Два шага в одной панели: сначала блюдо, потом куда и сколько. Разводить их по
 * экранам не на чем — роутера у приложения нет (раздел 9 ТЗ).
 */
export function ComposePanel({
  patientId,
  meals,
  onAdd,
  onCancel,
  saving,
  saveError,
}: {
  patientId: string;
  meals: number[];
  onAdd: (choice: {
    dish: DishOption;
    mealIndex: number;
    portionFactor: number;
  }) => void;
  onCancel: () => void;
  saving: boolean;
  saveError: unknown;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<DishOption | null>(null);
  const [mealIndex, setMealIndex] = useState(meals[0] ?? 1);
  const [portion, setPortion] = useState("1");

  // Запрос уходит не на каждую букву: полнотекстовый поиск на телефоне иначе
  // получает по обращению на нажатие клавиши.
  const debounced = useDebouncedValue(query, 300);
  const dishes = useDishOptions(patientId, debounced);

  const factor = Number(portion.replace(",", "."));
  const factorValid = Number.isFinite(factor) && factor > 0 && factor <= 99.99;

  if (chosen !== null) {
    return (
      <div className="flex flex-col gap-field">
        <p className="m-0 font-medium break-words">{chosen.title}</p>

        <label className="flex flex-col gap-1">
          <span>{t("menu.compose.meal")}</span>
          {/* Приёмов столько, сколько назначил врач (ADR-0029). Список, а не
              поле: номер приёма — выбор из назначенного, а не любое число. */}
          <select
            className="min-h-(--spacing-touch) rounded-xl border border-border bg-card px-3"
            value={mealIndex}
            onChange={(event) => setMealIndex(Number(event.target.value))}
          >
            {meals.map((index) => (
              <option key={index} value={index}>
                {t("menu.meal", { index })}
              </option>
            ))}
          </select>
        </label>

        {/* Подсказка — рядом с полем, а не внутри подписи: всё, что лежит в
            `label`, скринридер читает как имя поля, и человек слышал бы
            «Порций в раскладке рецепта 2 одна порция это 1». */}
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            <span>{t("menu.compose.portions")}</span>
            <Input
              type="text"
              inputMode="decimal"
              className="min-h-(--spacing-touch) w-28 tabular-nums"
              aria-describedby="compose-portions-hint"
              value={portion}
              onChange={(event) => setPortion(event.target.value)}
            />
          </label>
          <span
            id="compose-portions-hint"
            className="text-sm text-muted-foreground"
          >
            {chosen.servings === null
              ? t("menu.compose.portionsHintDish")
              : t("menu.compose.portionsHintRecipe", {
                  count: chosen.servings,
                })}
          </span>
        </div>

        {saveError != null && (
          <p role="alert" className="m-0 text-destructive">
            {errorMessageOf(saveError) ?? t("menu.compose.failed")}
          </p>
        )}

        <div className="flex flex-wrap gap-field">
          <Button
            type="button"
            className="min-h-touch"
            disabled={saving || !factorValid}
            onClick={() =>
              onAdd({ dish: chosen, mealIndex, portionFactor: factor })
            }
          >
            {saving ? t("menu.compose.adding") : t("menu.compose.add")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-touch"
            disabled={saving}
            onClick={() => setChosen(null)}
          >
            {t("menu.compose.back")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-field">
      <Input
        type="search"
        className="min-h-(--spacing-touch)"
        placeholder={t("menu.compose.search")}
        aria-label={t("menu.compose.search")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <AsyncSection
        loading={dishes.isPending}
        skeleton={null}
        error={
          dishes.isError
            ? {
                title: t("menu.compose.loadError"),
                description: t("home.loadErrorHint"),
              }
            : null
        }
        waiting={dishes.isPaused ? t("errors.waitingForNetwork") : null}
        retryLabel={t("actions.retry")}
        onRetry={dishes.refetch}
        isEmpty={dishes.options.length === 0}
        empty={
          <p className="m-0 text-muted-foreground">
            {t("menu.compose.nothingFound")}
          </p>
        }
      >
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {dishes.options.map((option) => (
            <li key={option.key}>
              <button
                type="button"
                className="min-h-(--spacing-touch) w-full rounded-xl border border-border px-3 py-2 text-left"
                onClick={() => setChosen(option)}
              >
                <span className="block break-words">{option.title}</span>
                {/* Показатели блюда, а не цель приёма: цель зависит от
                    назначения и считается в ките, а здесь выбирают из чего
                    собрать. Пусто — ядро ещё не посчитало раскладку. */}
                {/* Соотношение — значком кита, а не своим форматированием:
                    «3.9 : 1» пишется по единому правилу (П45 канона), и
                    `toFixed` на экране запрещён исполняемой проверкой. */}
                {(option.kcal !== null || option.ratio !== null) && (
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {option.kcal !== null && (
                      <span className="tabular-nums">
                        {t("menu.compose.kcal", {
                          value: formatKcal(option.kcal),
                        })}
                      </span>
                    )}
                    {option.ratio !== null && (
                      <RatioBadge ratio={option.ratio} />
                    )}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </AsyncSection>

      <Button
        type="button"
        variant="outline"
        className="min-h-touch self-start"
        onClick={onCancel}
      >
        {t("menu.compose.cancel")}
      </Button>
    </div>
  );
}
