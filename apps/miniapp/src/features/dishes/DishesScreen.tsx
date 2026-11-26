import { SegmentedControl, Skeleton } from "@ketocare/ui";
import { Suspense, lazy, useContext, useState } from "react";
import { useTranslation } from "react-i18next";

import { TabVisibleContext } from "../../lib/useTelegram";
import type { CalculatorSeed } from "../calculator/useCalculator";
import { RecipesScreen } from "../recipes/RecipesScreen";
import type { Session } from "../session/useSession";
import { ChildDishes } from "./ChildDishes";

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

const SECTIONS: readonly DishesSection[] = ["recipes", "dishes", "calculator"];

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
  const [section, setSection] = useState<DishesSection>("recipes");
  const [visited, setVisited] = useState<ReadonlySet<DishesSection>>(
    () => new Set<DishesSection>(["recipes"]),
  );

  // Блюдо ребёнка, открытое в расчёте (Б1). Состояние здесь, а не в
  // расчёте: «Открыть в расчёте» нажимают в соседнем разделе.
  const [seed, setSeed] = useState<CalculatorSeed | null>(null);
  // Открытое блюдо ребёнка — здесь же: к нему ведёт и карточка рецепта.
  const [dishId, setDishId] = useState<string | null>(null);

  const open = (next: DishesSection) => {
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    setSection(next);
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
