import {
  Button,
  ErrorState,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@ketocare/ui";
import { PackageSearch } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../components/Field";
import { SECTIONS_BY_ROLE } from "../auth/roles";
import { useOptionalSession } from "../auth/sessionContext";
import { SectionLink } from "../../components/SectionLink";
import { errorMessageOf } from "../../lib/api";
import {
  useProductSearch,
  useRecentProducts,
  type ProductOption,
} from "./useProducts";

interface Props {
  onPick: (product: ProductOption) => void;
  /** Уже добавленные продукты не предлагаются повторно */
  excludeIds: string[];
  /**
   * Чей это выбор.
   *
   * Нужен подсказке «недавние»: до ввода поле не помогало ничем, хотя семья
   * изо дня в день кладёт в меню одни и те же двадцать продуктов (правило П11
   * канона). Без пациента подсказки нет — например, у диетолога, собирающего
   * рецепт вообще.
   */
  patientId?: string;
  /**
   * Предлагать ли искать в рецептах, когда продукта не нашлось.
   *
   * Только там, где человек собирает БЛЮДО и мог набрать его название целиком:
   * так и вышло у заказчицы — «суп из говядины» в поиске продуктов. В форме
   * рецепта и в списке исключённых ребёнку продуктов совет искать в рецептах
   * бессмыслен, а уход по ссылке ещё и потерял бы незаписанное.
   */
  suggestRecipes?: boolean;
}

/**
 * Поиск продукта с автодополнением (раздел 8.3 ТЗ).
 *
 * Разметка combobox по WAI-ARIA: поле связано со списком через aria-controls,
 * активный вариант — через aria-activedescendant. Без этого пользователь
 * скринридера не узнает ни о появлении подсказок, ни о выбранном варианте.
 *
 * Список показывается в китовом `Popover`, а не своим `absolute` внутри
 * `relative`. Разница не в оформлении: рукописное позиционирование не умеет ни
 * упираться в край экрана, ни выходить за пределы прокручиваемого родителя.
 * Родитель добавляет блюдо в панели (`FormSheet`) с телефона — там поле часто
 * оказывается в нижней половине, и список обрезался краем окна. `Popover`
 * переносит содержимое в портал и сам переворачивает его вверх, когда снизу
 * места нет.
 *
 * Разметку и клавиатуру combobox оставляем свою: `cmdk` фильтрует список сам, а
 * здесь поиск серверный — и «недавние» намеренно стоят строкой кнопок ПОД
 * полем, а не в выпадающем списке (иначе они перекрывали бы форму).
 *
 * Ту же механику повторяет `features/doctor/DrugNameField.tsx`, и различие
 * между ними намеренное: здесь поле — строка ПОИСКА, выбор её очищает, и Enter
 * берёт первый вариант; там поле и есть значение, и Enter без явного выбора
 * стрелкой не делает ничего. Правя одно, посмотрите на второе. Общую часть
 * надо унести в кит — долг записан в `docs/AUDIT_UX.md`.
 */
export function ProductPicker({
  onPick,
  excludeIds,
  patientId,
  suggestRecipes = false,
}: Props) {
  const { t } = useTranslation("calculator");
  // Раздела «Рецепты» нет у врача (`SECTIONS_BY_ROLE`), и ссылка туда увела бы
  // его на главную: тупик того же рода, который здесь и закрывается (П3).
  const role = useOptionalSession()?.session?.role;
  const canOpenRecipes =
    suggestRecipes &&
    role !== undefined &&
    SECTIONS_BY_ROLE[role].includes("recipes");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  // Список закрыли щелчком мимо или Escape. Само по себе `isOpen` производное
  // и закрыться не может: пока в поле те же две буквы, условие снова истинно.
  const [dismissed, setDismissed] = useState(false);

  const listId = useId();
  const inputId = useId();
  const { data, isFetching, isError, error, refetch } = useProductSearch(query);

  const recent = useRecentProducts(patientId);

  const options = (data ?? []).filter((p) => !excludeIds.includes(p.id));
  // Недавние показываются, только пока поле пустое: как только человек начал
  // набирать, ответом на его ввод должен быть поиск, а не история.
  const recentOptions =
    query.trim() === ""
      ? (recent.data ?? []).filter((p) => !excludeIds.includes(p.id))
      : [];
  const isOpen = !dismissed && query.trim().length >= 2 && options.length > 0;
  // Упавший поиск без сообщения неотличим от «ничего не нашлось»: подсказок
  // нет в обоих случаях. Показываем ошибку с повтором (П15 канона).
  const searchFailed = isError && query.trim().length >= 2;

  // «Ничего не нашлось» и «ещё ищем» на экране выглядели одинаково — никак:
  // список просто не появлялся. Семья у плиты не понимала, продолжать ли
  // ждать, и повторяла запрос по буквам. Ответ нужен явный, и вместе с ним —
  // выход: справочник по тому же слову, где видно, что продукта нет вовсе, а
  // не что опечатка в наборе.
  const nothingFound =
    query.trim().length >= 2 && !isFetching && !isError && options.length === 0;

  function pick(product: ProductOption | undefined) {
    if (!product) return;
    onPick(product);
    setQuery("");
    setActiveIndex(0);
  }

  return (
    <div>
      <Popover open={isOpen} onOpenChange={(open) => setDismissed(!open)}>
        <PopoverAnchor asChild>
          <div>
            <Field
              id={inputId}
              label={t("addProduct")}
              width="wide"
              role="combobox"
              aria-expanded={isOpen}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                isOpen ? `${listId}-${activeIndex}` : undefined
              }
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
                setDismissed(false);
              }}
              onKeyDown={(event) => {
                if (!isOpen) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((i) => (i + 1) % options.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex(
                    (i) => (i - 1 + options.length) % options.length,
                  );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  pick(options[activeIndex]);
                } else if (event.key === "Escape") {
                  setQuery("");
                }
              }}
            />
          </div>
        </PopoverAnchor>

        {/* Ширину берём у поля (`--radix-popover-trigger-width` Radix
            выставляет по якорю), фокус оставляем в поле: combobox тем и
            отличается от меню, что человек продолжает печатать. */}
        <PopoverContent
          align="start"
          sideOffset={4}
          // Ширина повторяет поле, а не задаётся заново: на телефоне — во всю
          // ширину якоря (Radix отдаёт её в `--radix-popover-trigger-width`), с
          // `sm` — тот же предел `field-wide`, что у самого поля.
          className="max-h-72 w-[var(--radix-popover-trigger-width)] overflow-auto p-0 sm:max-w-field-wide"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <ul id={listId} role="listbox" className="m-0 list-none p-0">
            {options.map((product, index) => (
              <li
                key={product.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                /* Название строкой, состав — строкой под ним, всегда. Раньше
                   строка была свободной (`flex-wrap`), и раскладка зависела от
                   длины названия: «Кокосовое масло» умещалось с числами в одну
                   строку, «Масло оливковое» переносило их на вторую. Соседние
                   подсказки получались разной высоты, а числа — без общей
                   левой линии, то есть несравнимыми: именно их человек и
                   сравнивает, выбирая продукт. */
                className={`flex min-h-touch cursor-pointer flex-col gap-field px-3 py-2 ${
                  index === activeIndex
                    ? "bg-accent text-accent-foreground"
                    : ""
                }`}
                onMouseDown={(event) => {
                  // mouseDown, а не click: click срабатывает после blur поля,
                  // и список успевает закрыться раньше выбора.
                  event.preventDefault();
                  pick(product);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="min-w-0 break-words">{product.name}</span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {t("per100g", {
                    kcal: product.kcal.toFixed(0),
                    fat: product.fat.toFixed(1),
                    protein: product.protein.toFixed(1),
                    carbs: product.carbs.toFixed(1),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>

      {/* Состояние поиска объявляется отдельно: скринридер иначе не узнает,
        что список обновился. */}
      <span className="sr-only" role="status">
        {isFetching
          ? t("searching")
          : isOpen
            ? t("optionsFound", { count: options.length })
            : ""}
      </span>

      {/* Два выхода, а не один. Заказчица набрала здесь «суп из говядины» —
          название БЛЮДА в поиске ПРОДУКТОВ, — получила «ничего не нашлось» и
          дальше не пошла: состав остался пустым, кнопка подбора серой.
          Угадывать за человека, блюдо он ищет или продукт, нельзя и не нужно —
          достаточно назвать оба места и увести туда с тем же словом. */}
      {nothingFound && (
        <div
          role="status"
          className="mt-field flex flex-col gap-field text-sm text-muted-foreground"
        >
          <span className="flex items-center gap-field">
            <PackageSearch aria-hidden="true" className="size-4 shrink-0" />
            <span>
              {canOpenRecipes
                ? t("noMatchesDish", { query: query.trim() })
                : t("noMatches", { query: query.trim() })}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-field">
            <Button asChild variant="outline" size="sm" className="min-h-touch">
              <SectionLink section="products" query={query.trim()}>
                {t("openCatalog")}
              </SectionLink>
            </Button>
            {canOpenRecipes && (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="min-h-touch"
              >
                <SectionLink section="recipes" query={query.trim()}>
                  {t("openRecipes")}
                </SectionLink>
              </Button>
            )}
          </span>
        </div>
      )}

      {/* Недавние — не выпадающий список, а строка кнопок под полем: список
        перекрывал бы форму, а нажать на подсказку человек хочет сразу, не
        вызывая её раскрытием. */}
      {recentOptions.length > 0 && (
        <div className="mt-field flex flex-col gap-field">
          <span className="text-sm text-muted-foreground">{t("recent")}</span>
          <ul className="m-0 flex list-none flex-wrap gap-field p-0">
            {recentOptions.map((product) => (
              <li key={product.id}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-touch"
                  onClick={() => pick(product)}
                >
                  {product.name}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {searchFailed && (
        <ErrorState
          className="mt-field"
          title={t("searchError")}
          description={errorMessageOf(error) ?? t("common:errors.unexpected")}
          retryLabel={t("common:actions.retry")}
          onRetry={() => void refetch()}
        />
      )}
    </div>
  );
}
