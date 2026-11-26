import { SegmentedControl, Skeleton } from "@ketocare/ui";
import { Suspense, lazy, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { TabVisibleContext } from "../../lib/useTelegram";
import type { CalculatorSeed } from "../calculator/useCalculator";
import { RecipesScreen } from "../recipes/RecipesScreen";
import type { Session } from "../session/useSession";
import { useCustomDishes } from "../menu/useDishOptions";
import { ChildDishes, calculatedBy } from "./ChildDishes";

/**
 * Расчёт тянет за собой свой код подбора и проверки — грузится по первому
 * переходу, а не вместе с рецептами.
 */
const CalculatorScreen = lazy(() =>
  import("../calculator/CalculatorScreen").then((m) => ({
    default: m.CalculatorScreen,
  })),
);

export type DishesSection = "recipes" | "dishes" | "calculator";

// Блюда ребёнка — первыми: это его порции, рассчитанные под назначение, а
// рецепты базы — шаблоны. Вкладка открывалась на шаблонах, и семья сверяла
// лист диетолога с рецептом (аудит 26.11.2026, 3.17).
const SECTIONS: readonly DishesSection[] = ["dishes", "recipes", "calculator"];

/**
 * «Блюда» — рецепты, блюда ребёнка и расчёт на одной вкладке (ADR-0075).
 *
 * Три бывших места отвечают на один вопрос — что приготовить, — поэтому они
 * стали разделами одной вкладки с переключателем, а не тремя вкладками внизу.
 * Посещённые разделы остаются смонтированными, скрытыми: собранный в расчёте
 * состав и открытый рецепт не теряются, когда человек заглядывает в соседний
 * раздел (то же правило, что у вкладок, — `Screens`).
 */
export function DishesScreen({ session }: { session: Session }) {
  const { t } = useTranslation();
  // Кнопки Telegram («Назад», «Сохранить») у скрытого раздела сняты, как у
  // скрытой вкладки: открытая карточка рецепта не должна закрываться нажатием,
  // сделанным в расчёте.
  const tabVisible = useContext(TabVisibleContext);
  const childDishes = useCustomDishes(session.patientId);
  const [chosen, setChosen] = useState<DishesSection | null>(null);
  // Пока человек не выбрал сам: блюда ребёнка, а если их нет — рецепты.
  // Решается один раз, когда список пришёл: удалив последнее блюдо, человек
  // не должен оказаться в рецептах.
  const loadedEmpty = childDishes.data?.length === 0;
  useEffect(() => {
    if (chosen === null && childDishes.data !== undefined) {
      setChosen(childDishes.data.length === 0 ? "recipes" : "dishes");
    }
  }, [chosen, childDishes.data]);
  const section: DishesSection = chosen ?? (loadedEmpty ? "recipes" : "dishes");
  const [visitedByChoice, setVisited] = useState<ReadonlySet<DishesSection>>(
    () => new Set<DishesSection>(),
  );
  const visited = new Set<DishesSection>([...visitedByChoice, section]);

  // Блюдо ребёнка, открытое в расчёте (Б1). Состояние здесь, а не в
  // расчёте: «Открыть в расчёте» нажимают в соседнем разделе.
  const [seed, setSeed] = useState<CalculatorSeed | null>(null);
  // Открытое блюдо ребёнка — здесь же: к нему ведёт и карточка рецепта.
  const [dishId, setDishId] = useState<string | null>(null);

  const open = (next: DishesSection) => {
    setVisited((prev) => new Set<DishesSection>([...prev, section, next]));
    setChosen(next);
  };

  return (
    <main className="flex flex-col gap-section p-section">
      <h1 className="text-page-title">{t("dishes.title")}</h1>
      <SegmentedControl
        label={t("dishes.section")}
        value={section}
        onChange={open}
        items={SECTIONS.map((value) => ({
          value,
          label: t(`dishes.sections.${value}`),
        }))}
        className="w-full [&>label]:flex-1"
      />

      {SECTIONS.filter((value) => visited.has(value)).map((value) => (
        <div key={value} hidden={value !== section} data-section={value}>
          <TabVisibleContext value={tabVisible && value === section}>
            {value === "recipes" && (
              <RecipesScreen
                patientId={session.patientId}
                onOpenChildDish={(id) => {
                  setDishId(id);
                  open("dishes");
                  window.scrollTo(0, 0);
                }}
              />
            )}
            {value === "dishes" && (
              <ChildDishes
                patientId={session.patientId}
                openId={dishId}
                onOpenIdChange={setDishId}
                onOpenCalculator={() => open("calculator")}
                onOpenInCalculator={(dish) => {
                  setSeed((prev) => ({
                    key: (prev?.key ?? 0) + 1,
                    dishId: dish.id,
                    title: dish.title,
                    ingredients: dish.ingredients,
                    calculatedBy: calculatedBy(dish, t),
                  }));
                  open("calculator");
                  window.scrollTo(0, 0);
                }}
              />
            )}
            {value === "calculator" && (
              <Suspense
                fallback={<Skeleton className="h-32 w-full rounded-xl" />}
              >
                <CalculatorScreen session={session} seed={seed} />
              </Suspense>
            )}
          </TabVisibleContext>
        </div>
      ))}
    </main>
  );
}
