import {
  ActionReason,
  AsyncSection,
  Button,
  FieldShell,
  Input,
  NativeSelect,
  RatioBadge,
  formatKcal,
  useDebouncedValue,
} from "@ketocare/ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { hideKeyboard } from "../../lib/telegram";
import { useBottomButtons, useTelegramBack } from "../../lib/useTelegram";
import { type DishOption, useDishOptions } from "./useDishOptions";

export interface ComposeChoice {
  dish: DishOption;
  mealIndex: number;
  portionFactor: number;
}

/**
 * Добавление блюд в меню дня — экран поверх меню, пока человек не скажет
 * «Готово».
 *
 * **Панель не закрывается после каждого блюда и помнит приём** (аудит
 * 12.11.2026, ADR-0075). Прежде после каждого добавления она закрывалась, а
 * приём сбрасывался на первый: пять приёмов собирались за двадцать пять
 * нажатий. Теперь приём приходит из строки «+ блюдо» того приёма, где нажали,
 * и остаётся выбранным, пока его не сменят; после добавления панель
 * возвращается к списку с тем же поиском и строкой «добавлено».
 *
 * Панель разворачивается на месте меню, а не всплывает окном: в встроенном
 * браузере Telegram модальное окно приходится держать самому — возврат,
 * прокрутку, фокус, — и каждый такой слой однажды ломал запуск.
 */
export function ComposePanel({
  patientId,
  meals,
  initialMeal,
  onAdd,
  onDone,
  saving,
  saveError,
}: {
  patientId: string;
  meals: number[];
  /** Приём, у которого нажали «+ блюдо». */
  initialMeal: number;
  /** `onAdded` — позвать после успешной записи. */
  onAdd: (choice: ComposeChoice, onAdded: () => void) => void;
  onDone: () => void;
  saving: boolean;
  saveError: unknown;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<DishOption | null>(null);
  const [mealIndex, setMealIndex] = useState(initialMeal);
  const [portion, setPortion] = useState("1");
  const [added, setAdded] = useState<{ title: string; meal: number } | null>(
    null,
  );
  const reasonId = useId();

  // Запрос уходит не на каждую букву: полнотекстовый поиск на телефоне иначе
  // получает по обращению на нажатие клавиши.
  const debounced = useDebouncedValue(query, 300);
  const dishes = useDishOptions(patientId, debounced);

  const factor = Number(portion.replace(",", "."));
  const factorValid = Number.isFinite(factor) && factor > 0 && factor <= 99.99;
  // Отключённая кнопка называет причину (правило П44 канона): серая
  // «Добавить в меню» без слов читалась как поломка.
  const reason = factorValid ? null : t("menu.compose.portionInvalid");

  const add = () => {
    if (chosen === null || !factorValid || saving) return;
    const dish = chosen;
    const meal = mealIndex;
    onAdd({ dish, mealIndex: meal, portionFactor: factor }, () => {
      setAdded({ title: dish.title, meal });
      setChosen(null);
      setPortion("1");
    });
  };
  const backToList = () => {
    setChosen(null);
  };

  // «Назад» Telegram — шаг панели назад: от выбранного блюда к списку, от
  // списка — закрыть панель. Без неё аппаратная «Назад» на Android закрывала
  // весь Mini App посреди сборки дня.
  useTelegramBack(saving ? null : chosen !== null ? backToList : onDone);

  // Главное действие — родной кнопкой Telegram внизу экрана (Bot API 7.10),
  // вне Telegram и в старом клиенте — кнопками на странице.
  const native = useBottomButtons(
    chosen !== null
      ? {
          main: {
            text: saving ? t("menu.compose.adding") : t("menu.compose.add"),
            onClick: add,
            disabled: !factorValid,
            progress: saving,
          },
          secondary: { text: t("menu.compose.back"), onClick: backToList },
        }
      : { main: { text: t("menu.compose.done"), onClick: onDone } },
  );

  const mealField = (
    <FieldShell label={t("menu.compose.meal")}>
      {() => (
        // Приёмов столько, сколько назначил врач (ADR-0029). Список, а не
        // поле: номер приёма — выбор из назначенного, а не любое число.
        <NativeSelect
          value={mealIndex}
          onChange={(event) => setMealIndex(Number(event.target.value))}
        >
          {meals.map((index) => (
            <option key={index} value={index}>
              {t("menu.meal", { index })}
            </option>
          ))}
        </NativeSelect>
      )}
    </FieldShell>
  );

  if (chosen !== null) {
    return (
      <div className="flex flex-col gap-field">
        <p className="m-0 font-medium break-words">{chosen.title}</p>
        {mealField}

        {/* Подсказка — рядом с полем, а не внутри подписи: всё, что лежит в
            `label`, скринридер читает как имя поля. */}
        <FieldShell
          label={t("menu.compose.portions")}
          hint={
            chosen.servings === null
              ? t("menu.compose.portionsHintDish")
              : t("menu.compose.portionsHintRecipe", {
                  count: chosen.servings,
                })
          }
        >
          {({ describedBy }) => (
            <Input
              type="text"
              inputMode="decimal"
              className="min-h-touch w-28 tabular-nums"
              aria-describedby={describedBy}
              value={portion}
              onChange={(event) => setPortion(event.target.value)}
            />
          )}
        </FieldShell>

        {saveError != null && (
          <p role="alert" className="m-0 text-destructive">
            {errorMessageOf(saveError) ?? t("menu.compose.failed")}
          </p>
        )}

        {!native && (
          <div className="flex flex-col gap-field">
            <Button
              type="button"
              className="min-h-touch w-full"
              disabled={saving || !factorValid}
              aria-busy={saving || undefined}
              aria-describedby={reason !== null ? reasonId : undefined}
              onClick={add}
            >
              {saving ? t("menu.compose.adding") : t("menu.compose.add")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-touch w-full"
              disabled={saving}
              onClick={backToList}
            >
              {t("menu.compose.back")}
            </Button>
          </div>
        )}
        <ActionReason id={reasonId}>{reason}</ActionReason>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-field">
      {mealField}

      {added !== null && (
        <p role="status" className="m-0 text-sm text-success">
          {t("menu.compose.addedTo", {
            title: added.title,
            index: added.meal,
          })}
        </p>
      )}

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
                onClick={() => {
                  // Клавиатура закрывала половину экрана с выбранным блюдом.
                  hideKeyboard();
                  setAdded(null);
                  setChosen(option);
                }}
              >
                <span className="block break-words">{option.title}</span>
                {/* Показатели блюда, а не цель приёма: цель зависит от
                    назначения и считается в ките, а здесь выбирают из чего
                    собрать. Соотношение — значком кита; совпадение с
                    назначением решает сервер (`fits`). */}
                {(option.kcal !== null || option.ratio !== null) && (
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {option.kcal !== null && (
                      <span className="tabular-nums">
                        {t(
                          option.servings === null
                            ? "menu.compose.kcal"
                            : "menu.compose.kcalPortion",
                          { value: formatKcal(option.kcal) },
                        )}
                      </span>
                    )}
                    {option.ratio !== null && (
                      <RatioBadge
                        ratio={option.ratio}
                        withinTolerance={option.fits}
                      />
                    )}
                    {option.fits === false && (
                      <span className="text-warning-strong">
                        {t("recipes.ratioDiffers")}
                      </span>
                    )}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {dishes.hasMore && (
          <Button
            type="button"
            variant="outline"
            className="min-h-touch w-full"
            disabled={dishes.loadingMore}
            aria-busy={dishes.loadingMore || undefined}
            onClick={dishes.loadMore}
          >
            {dishes.loadingMore ? t("actions.loading") : t("actions.showMore")}
          </Button>
        )}
      </AsyncSection>

      {!native && (
        <Button type="button" className="min-h-touch w-full" onClick={onDone}>
          {t("menu.compose.done")}
        </Button>
      )}
    </div>
  );
}
