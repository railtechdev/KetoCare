import {
  BookOpen,
  Bot,
  Calculator,
  ChartLine,
  House,
  UtensilsCrossed,
} from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@ketocare/ui";
import { TabBar, type TabBarItem } from "./components/TabBar";
import { HomeScreen } from "./features/home/HomeScreen";
import { MenuScreen } from "./features/menu/MenuScreen";
import { SessionGate } from "./features/session/SessionGate";
import type { Session } from "./features/session/useSession";
import { webApp } from "./lib/telegram";
import { applyTelegramTheme, watchTelegramTheme } from "./lib/theme";

type TabId =
  "home" | "menu" | "calculator" | "recipes" | "charts" | "assistant";

/**
 * Mini App: кабинет родителя внутри Telegram (раздел 9 ТЗ).
 *
 * Врачебного и административного здесь нет ничего — ни по замыслу, ни по
 * доступу: сессия сужена до одного ребёнка (ADR-0017).
 */
/**
 * Вкладки сверх первых двух грузятся по требованию.
 *
 * Замер до разделения: Mini App собирался в один файл 877 кБ (257 кБ gzip), и
 * внутри — recharts с lodash на 705 кБ из 2 408 кБ исходников, то есть 29 %.
 * Родитель открывает приложение из чата, чтобы посмотреть план на сегодня, а
 * скачивает вместе с ним библиотеку графиков, калькулятор и помощника.
 *
 * «Сводка» и «План дня» остаются в стартовом чанке: с них начинают, и лишний
 * запрос на самой частой вкладке — это задержка там, где её видно каждый раз.
 */
const CalculatorScreen = lazy(() =>
  import("./features/calculator/CalculatorScreen").then((m) => ({
    default: m.CalculatorScreen,
  })),
);
const ChartsScreen = lazy(() =>
  import("./features/charts/ChartsScreen").then((m) => ({
    default: m.ChartsScreen,
  })),
);
const RecipesScreen = lazy(() =>
  import("./features/recipes/RecipesScreen").then((m) => ({
    default: m.RecipesScreen,
  })),
);
const AssistantScreen = lazy(() =>
  import("./features/assistant/AssistantScreen").then((m) => ({
    default: m.AssistantScreen,
  })),
);

export function App() {
  useEffect(() => {
    const app = webApp();
    // `ready` говорит клиенту, что можно убирать заставку, `expand` —
    // развернуть окно на всю высоту. Без первого приложение открывается в
    // полупустом окне поверх спиннера Telegram.
    app?.ready();
    app?.expand();

    applyTelegramTheme();
    return watchTelegramTheme();
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-background pt-[var(--safe-top,0px)]">
      <SessionGate>{(session) => <Screens session={session} />}</SessionGate>
    </div>
  );
}

function Screens({ session }: { session: Session }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>("home");

  const tabs: readonly TabBarItem<TabId>[] = [
    { id: "home", label: t("tabs.home"), icon: House },
    { id: "menu", label: t("tabs.menu"), icon: UtensilsCrossed },
    { id: "calculator", label: t("tabs.calculator"), icon: Calculator },
    { id: "recipes", label: t("tabs.recipes"), icon: BookOpen },
    { id: "charts", label: t("tabs.charts"), icon: ChartLine },
    // Шестая и последняя: больше в нижнюю полосу не помещается — на 360 px
    // это по 60 px на вкладку, и подпись перестаёт читаться.
    { id: "assistant", label: t("tabs.assistant"), icon: Bot },
  ];

  return (
    <>
      <div className="flex-1">
        {/* Пока чанк вкладки едет — скелетон, а не пустота: в Telegram
            приложение открывается поверх чата, и мигание пустым экраном
            читается как «не загрузилось». */}
        <Suspense fallback={<TabSkeleton />}>
          {tab === "home" && <HomeScreen session={session} />}
          {tab === "menu" && <MenuScreen session={session} />}
          {tab === "calculator" && <CalculatorScreen session={session} />}
          {tab === "recipes" && <RecipesScreen />}
          {tab === "charts" && <ChartsScreen session={session} />}
          {tab === "assistant" && <AssistantScreen session={session} />}
        </Suspense>
      </div>
      <TabBar items={tabs} active={tab} onSelect={setTab} />
    </>
  );
}

/** Заглушка вкладки в форме будущего содержимого. */
function TabSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-block p-4">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}
