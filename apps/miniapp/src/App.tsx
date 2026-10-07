import {
  BookOpen,
  Bot,
  Calculator,
  House,
  NotebookPen,
  UtensilsCrossed,
} from "lucide-react";
import {
  Suspense,
  lazy,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import {
  KitLabelsProvider,
  Skeleton,
  Toaster,
  kitLabelsFrom,
} from "@ketocare/ui";
import { TabBar, type TabBarItem } from "./components/TabBar";
import { HomeScreen } from "./features/home/HomeScreen";
import { MenuScreen } from "./features/menu/MenuScreen";
import { ChildSwitcher } from "./features/session/ChildSwitcher";
import { SessionGate } from "./features/session/SessionGate";
import type { Session } from "./features/session/useSession";
import { TabVisibleContext } from "./lib/useTelegram";

type TabId = "home" | "menu" | "calculator" | "recipes" | "diary" | "assistant";

/**
 * Mini App: кабинет родителя внутри Telegram (раздел 9 ТЗ).
 *
 * Врачебного и административного здесь нет ничего — ни по замыслу, ни по
 * доступу: сессия сужена до одного ребёнка (ADR-0017). Если Telegram ведёт
 * нескольких детей, другой открывается новой сессией (ADR-0048).
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
const DiaryScreen = lazy(() =>
  import("./features/diary/DiaryScreen").then((m) => ({
    default: m.DiaryScreen,
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

/**
 * Тема, `ready()` и `expand()` — в `main.tsx` до первой отрисовки
 * (`initTelegram`, `applyTelegramTheme`): из эффекта они успевали показать
 * кадр светлой темы в тёмном Telegram.
 */
export function App() {
  return (
    <AppKitLabels>
      {/* Безопасная зона со всех сторон: в альбомной ориентации вырез экрана
          сбоку закрывал бы край списка. */}
      <div className="flex min-h-dvh flex-col bg-background pt-[var(--safe-top,0px)] pr-[var(--safe-right,0px)] pl-[var(--safe-left,0px)]">
        <SessionGate>
          {(session, { switchChild }) => (
            <Screens session={session} onSwitchChild={switchChild} />
          )}
        </SessionGate>
        {/* Подтверждения действий («Запись исправлена») — тостами кита. */}
        <Toaster position="top-center" />
      </div>
    </AppKitLabels>
  );
}

/** Подписи кита на языке экрана (ADR-0052): «Yog‘lar», а не «Жиры». */
function AppKitLabels({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const labels = useMemo(
    () => kitLabelsFrom((key, values) => t(key, values)),
    // Язык — явная зависимость: `t` между языками может остаться той же ссылкой.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, i18n.language],
  );
  return <KitLabelsProvider labels={labels}>{children}</KitLabelsProvider>;
}

const SCREENS: Record<TabId, ComponentType<{ session: Session }>> = {
  home: HomeScreen,
  menu: MenuScreen,
  calculator: CalculatorScreen,
  recipes: RecipesScreen,
  diary: DiaryScreen,
  assistant: AssistantScreen,
};

export function Screens({
  session,
  onSwitchChild,
}: {
  session: Session;
  onSwitchChild: (patientId: string) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>("home");
  // Посещённые вкладки остаются смонтированными, скрытыми: переход на план
  // дня посреди сборки блюда в калькуляторе стирал состав, недописанный
  // вопрос помощнику, открытый рецепт и панель сборки дня. Не посещённые не
  // монтируются вовсе — их чанки и запросы ждут первого перехода.
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(
    () => new Set<TabId>(["home"]),
  );
  // Прокрутка у окна одна на все вкладки: без памяти вкладка открывалась бы
  // на высоте предыдущей.
  const scrollByTab = useRef(new Map<TabId, number>());

  function select(next: TabId) {
    if (next === tab) return;
    scrollByTab.current.set(tab, window.scrollY);
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    setTab(next);
    // После отрисовки новой вкладки, когда у страницы её высота.
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollByTab.current.get(next) ?? 0);
    });
  }

  const tabs: readonly TabBarItem<TabId>[] = [
    { id: "home", label: t("tabs.home"), icon: House },
    { id: "menu", label: t("tabs.menu"), icon: UtensilsCrossed },
    { id: "calculator", label: t("tabs.calculator"), icon: Calculator },
    { id: "recipes", label: t("tabs.recipes"), icon: BookOpen },
    // Не новая вкладка, а прежняя «Динамика», ставшая дневником: седьмой
    // в полосе места нет (ADR-0044).
    { id: "diary", label: t("tabs.diary"), icon: NotebookPen },
    // Шестая и последняя: больше в нижнюю полосу не помещается — на 360 px
    // это по 60 px на вкладку, и подпись перестаёт читаться.
    { id: "assistant", label: t("tabs.assistant"), icon: Bot },
  ];

  return (
    <>
      {/* Над экранами, а не на одной вкладке: какой ребёнок открыт, важно на
          каждой — запись в дневник уходит именно ему (ADR-0048). */}
      <ChildSwitcher session={session} onSwitch={onSwitchChild} />
      <div className="flex-1">
        {/* Пока чанк вкладки едет — скелетон, а не пустота: в Telegram
            приложение открывается поверх чата, и мигание пустым экраном
            читается как «не загрузилось». */}
        {tabs
          .filter(({ id }) => visited.has(id))
          .map(({ id }) => {
            const Screen = SCREENS[id];
            return (
              // `hidden` убирает скрытую вкладку и из дерева доступности: её
              // заголовок и поля не мешают программе чтения с экрана.
              <div key={id} hidden={id !== tab} data-tab={id}>
                <TabVisibleContext value={id === tab}>
                  {/* Своя граница ожидания у каждой вкладки: чанк новой
                      вкладки не должен прятать уже открытые за скелетоном. */}
                  <Suspense fallback={<TabSkeleton />}>
                    <Screen session={session} />
                  </Suspense>
                </TabVisibleContext>
              </div>
            );
          })}
      </div>
      <TabBar items={tabs} active={tab} onSelect={select} />
    </>
  );
}

/** Заглушка вкладки в форме будущего содержимого. */
function TabSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col gap-section p-4"
    >
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}
