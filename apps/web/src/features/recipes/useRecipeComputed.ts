import { RECALC_DELAY_MS, useDebouncedValue } from "@ketocare/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import type { DishView } from "../calculator/DishResultView";
import { useProductDetails } from "./useRecipes";

/** Строка состава формы рецепта: продукт и его масса. */
export interface CompositionRow {
  productId: string;
  grams: number;
}

export interface RecipeComputed {
  /** Показатели блюда целиком. `null` — считать пока нечего или ещё нечем */
  dish: DishView | null;
  /** Вклад каждой позиции: сколько даёт именно этот продукт */
  contributions: Map<string, ItemContribution>;
  /**
   * Показанное посчитано не по тому, что сейчас в полях.
   *
   * Отдельно от `pending`, и это важно: незаполненная строка состава держит
   * расчёт неопределённо долго, и «идёт расчёт» в этом случае было бы
   * неправдой — а для читающего с экрана ещё и бесконечным «занято».
   */
  stale: boolean;
  /** Расчёт идёт прямо сейчас */
  pending: boolean;
  isError: boolean;
}

interface ItemContribution {
  kcal: number;
  fat_g: number;
  protein_g: number;
  carbs_g: number;
}

/**
 * Показатели рецепта по мере правки состава.
 *
 * **Зачем.** Форма рецепта не показывала ни одного числа: под составом стояло
 * «показатели пересчитываются на сервере после сохранения». Подобрать граммовку
 * в форме было нельзя в принципе — сохранить, посмотреть, вернуться, поправить,
 * и так по кругу. Заказчица просила об этом дважды, про блюдо целиком и про
 * каждую строку: «чтобы при превышении ккал мы могли уменьшать граммы продуктов
 * и подобрать нужные нам ккал».
 *
 * **Считает сервер.** Умножить состав на граммы в браузере просто, но это был
 * бы второй источник клинических чисел рядом с расчётным ядром: соотношение и
 * калорийность обязаны совпадать с тем, что сохранится (правило 2 CLAUDE.md).
 * Отсюда же вклад позиций — он приходит в ответе, а не считается здесь.
 *
 * **Прежние числа остаются на экране, пока считаются новые** (`keepPreviousData`):
 * гасить их на каждое нажатие значит очищать то, по чему человек и правит
 * граммовку. Устаревшее помечается, а не прячется.
 *
 * Продукты дочитываются по идентификаторам: в форме рецепта состав хранится
 * ссылками, а `/calc/verify` ждёт значения на 100 г. Запрос уходит, только
 * когда карточки всех продуктов уже получены, — иначе сервер посчитал бы блюдо
 * по неполному составу и вернул уверенное неверное число.
 */
export function useRecipeComputed(rows: CompositionRow[]): RecipeComputed {
  const details = useProductDetails(rows.map((row) => row.productId));

  // Считать можно, когда у КАЖДОЙ строки есть продукт, масса и его карточка:
  // неполный состав сервер посчитал бы честно — и вернул уверенное число не о
  // том блюде.
  const usable = rows.filter(
    (row) =>
      row.productId !== "" && row.grams > 0 && details.byId[row.productId],
  );
  const complete = rows.length > 0 && usable.length === rows.length;

  /**
   * Состав строкой — чтобы сравнивать его по содержимому, а не по ссылке.
   *
   * Массив здесь пересобирается на каждом рендере, и сравнение по ссылке
   * (как в калькуляторе, где состав лежит в состоянии) всегда давало бы
   * «устарело»: числа не переставали бы гаснуть никогда.
   */
  const signature = usable
    .map((row) => `${row.productId}:${row.grams}`)
    .join("|");
  const debouncedSignature = useDebouncedValue(signature, RECALC_DELAY_MS);
  const settled = signature === debouncedSignature;
  const ready = complete && settled;

  const query = useQuery({
    queryKey: ["calc", "verify", "recipe-form", debouncedSignature],
    // Запрос уходит только на устоявшемся составе, поэтому тело ниже описывает
    // ровно тот состав, по которому построен ключ.
    enabled: ready,
    // Прежний ответ держится на экране, пока считается новый.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await api.POST("/api/v1/calc/verify", {
        body: {
          ingredients: usable.map((row) => {
            const product = details.byId[row.productId]!;
            return {
              product_id: product.id,
              kcal: product.kcal_100g,
              fat: product.fat_100g,
              protein: product.protein_100g,
              carbs: product.carbs_100g,
              fiber: product.fiber_100g,
            };
          }),
          items: usable.map((row) => ({
            product_id: row.productId,
            grams: row.grams,
          })),
          targets: null,
          patient_id: null,
        },
      });
      if (error || !data) throw error ?? new Error("Empty verify response");
      return data;
    },
  });

  /**
   * Вклад по идентификатору продукта.
   *
   * Один и тот же продукт дважды в составе строка не различит — обе покажут
   * последний вклад. Сегодня такого состава не собрать: поиск не предлагает
   * уже добавленное, а импорт отвергает повтор. Сопоставление по порядку
   * решало бы этот случай, но ломало более частый: пока расчёт догоняет
   * правку, удалённая строка сдвигала бы чужие числа под соседние продукты.
   */
  const contributions = new Map<string, ItemContribution>(
    (query.data?.dish.items ?? []).map((item) => [item.product_id, item]),
  );

  return {
    dish: query.data?.dish ?? null,
    contributions,
    // Пока состав правят, показанное относится к прежнему набору. Незавершённый
    // состав (пустая строка, ноль граммов, ещё не полученная карточка) — тоже
    // «устарело»: сказать о таком блюде нечего.
    stale: query.isFetching || !ready,
    pending: query.isFetching,
    // Карточки продуктов — часть расчёта: без них он не уйдёт вовсе, и молчать
    // об этом нельзя, иначе чисел просто не будет и никто не поймёт почему.
    isError: query.isError || details.isError,
  };
}
