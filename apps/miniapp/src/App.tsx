import { Bot, House, NotebookPen, UtensilsCrossed } from "lucide-react";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import type { CreatableKind } from "./features/diary/useDiary";
import { ChildSwitcher } from "./features/session/ChildSwitcher";
import { SessionGate } from "./features/session/SessionGate";
import type { Session } from "./features/session/useSession";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { TodayScreen, type TodayRequest } from "./features/today/TodayScreen";
import {
  type LaunchTarget,
  type SettingsSection,
  readLaunchTarget,
} from "./lib/launchTarget";
import {
  NavigateContext,
  type ScreenRequest,
  type TabId,
  rememberTab,
  rememberedCloudTab,
  rememberedTab,
} from "./lib/tabs";
import { TabVisibleContext, useSettingsButton } from "./lib/useTelegram";

/**
 * Mini App: кабинет родителя внутри Telegram (раздел 9 ТЗ).
 *
 * Врачебного и административного здесь нет ничего — ни по замыслу, ни по
 * доступу: сессия сужена до одного ребёнка (ADR-0017). Если Telegram ведёт
 * нескольких детей, другой открывается новой сессией (ADR-0048).
 */
/**
 * Вкладки, кроме «Сегодня», грузятся по требованию.
 *
 * Замер до разделения: Mini App собирался в один файл 877 кБ (257 кБ gzip), и
 * внутри — recharts с lodash на 705 кБ из 2 408 кБ исходников, то есть 29 %.
 * Родитель открывает приложение из чата, чтобы посмотреть меню на сегодня, а
 * скачивал вместе с ним библиотеку графиков, расчёт и помощника.
 */
const DiaryScreen = lazy(() =>
  import("./features/diary/DiaryScreen").then((m) => ({
    default: m.DiaryScreen,
  })),
);
const DishesScreen = lazy(() =>
  import("./features/dishes/DishesScreen").then((m) => ({
    default: m.DishesScreen,
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
  // Параметр запуска читается один раз за жизнь страницы и применяется один
  // раз: смена ребёнка пересобирает экраны, и форма из кнопки бота не должна
  // открываться второй раз у другого ребёнка.
  const [launch, setLaunch] = useState(readLaunchTarget);

  return (
    <AppKitLabels>
      {/* Безопасная зона со всех сторон: в альбомной ориентации вырез экрана
          сбоку закрывал бы край списка. */}
      <div className="flex min-h-dvh flex-col bg-background pt-[var(--safe-top,0px)] pr-[var(--safe-right,0px)] pl-[var(--safe-left,0px)]">
        <SessionGate>
          {(session, { switchChild }) => (
            <Screens
              session={session}
              onSwitchChild={switchChild}
              launch={launch}
              onLaunchUsed={() => setLaunch(null)}
            />
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

const TAB_ORDER: readonly TabId[] = ["today", "diary", "dishes", "assistant"];

/** Первая вкладка: из параметра запуска, иначе запомненная, иначе «Сегодня». */
function initialTab(launch: LaunchTarget | null): TabId {
  if (launch !== null && "tab" in launch) return launch.tab;
  return rememberedTab() ?? "today";
}

let requestCounter = 0;

function requestOf(target: LaunchTarget): ScreenRequest<LaunchTarget> | null {
  return "tab" in target ? { id: ++requestCounter, target } : null;
}

export function Screens({
  session,
  onSwitchChild,
  launch = null,
  onLaunchUsed,
}: {
  session: Session;
  onSwitchChild: (patientId: string) => void;
  launch?: LaunchTarget | null;
  onLaunchUsed?: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>(() => initialTab(launch));
  // Посещённые вкладки остаются смонтированными, скрытыми: переход на меню
  // посреди сборки блюда в расчёте стирал состав, недописанный вопрос
  // помощнику, открытый рецепт. Не посещённые не монтируются вовсе — их чанки
  // и запросы ждут первого перехода.
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(
    () => new Set<TabId>([initialTab(launch)]),
  );
  const [request, setRequest] = useState<ScreenRequest<LaunchTarget> | null>(
    () => (launch === null ? null : requestOf(launch)),
  );
  const [settings, setSettings] = useState<{
    section?: SettingsSection;
  } | null>(() =>
    launch !== null && "settings" in launch
      ? { section: launch.section }
      : null,
  );
  // Прокрутка у окна одна на все вкладки: без памяти вкладка открывалась бы
  // на высоте предыдущей.
  const scrollByTab = useRef(new Map<TabId | "settings", number>());
  // Человек уже выбрал сам — облако Telegram, ответившее позже, не перебивает.
  const chosen = useRef(launch !== null);

  useEffect(() => {
    if (launch !== null) onLaunchUsed?.();
    // Только при первой отрисовке: параметр запуска одноразовый.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = useCallback((next: TabId) => {
    chosen.current = true;
    rememberTab(next);
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    setTab((current) => {
      if (current === next) return current;
      scrollByTab.current.set(current, window.scrollY);
      // После отрисовки новой вкладки, когда у страницы её высота.
      requestAnimationFrame(() => {
        window.scrollTo(0, scrollByTab.current.get(next) ?? 0);
      });
      return next;
    });
  }, []);

  // Вкладка с другого устройства — если здесь её ещё не запоминали.
  useEffect(() => {
    if (chosen.current || rememberedTab() !== null) return;
    rememberedCloudTab((cloudTab) => {
      if (chosen.current) return;
      setVisited((prev) =>
        prev.has(cloudTab) ? prev : new Set(prev).add(cloudTab),
      );
      setTab(cloudTab);
    });
  }, []);

  const openSettings = useCallback((section?: SettingsSection) => {
    scrollByTab.current.set("settings", window.scrollY);
    setSettings({ section });
    window.scrollTo(0, 0);
  }, []);
  const closeSettings = useCallback(() => {
    setSettings(null);
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollByTab.current.get("settings") ?? 0);
    });
  }, []);
  useSettingsButton(() => openSettings());

  const navigate = useCallback(
    (target: LaunchTarget) => {
      if ("settings" in target) {
        openSettings(target.section);
        return;
      }
      setSettings(null);
      select(target.tab);
      setRequest(requestOf(target));
    },
    [openSettings, select],
  );

  const tabs: readonly TabBarItem<TabId>[] = [
    { id: "today", label: t("tabs.today"), icon: House },
    { id: "diary", label: t("tabs.diary"), icon: NotebookPen },
    { id: "dishes", label: t("tabs.dishes"), icon: UtensilsCrossed },
    { id: "assistant", label: t("tabs.assistant"), icon: Bot },
  ];

  const todayRequest = narrow<TodayRequest>(request, "today", (target) =>
    "view" in target ? { view: target.view, dayOffset: target.dayOffset } : {},
  );
  const diaryRequest = narrow<{ addKind?: CreatableKind }>(
    request,
    "diary",
    (target) => ("addKind" in target ? { addKind: target.addKind } : {}),
  );

  return (
    <NavigateContext value={navigate}>
      {settings !== null && (
        <SettingsScreen
          session={session}
          section={settings.section}
          onClose={closeSettings}
        />
      )}
      <div hidden={settings !== null} className="flex flex-1 flex-col">
        <ChildSwitcher
          session={session}
          onSwitch={onSwitchChild}
          onOpenSettings={() => openSettings()}
        />
        <div className="flex-1">
          {/* Пока чанк вкладки едет — скелетон, а не пустота: в Telegram
              приложение открывается поверх чата, и мигание пустым экраном
              читается как «не загрузилось». */}
          {TAB_ORDER.filter((id) => visited.has(id)).map((id) => (
            // `hidden` убирает скрытую вкладку и из дерева доступности: её
            // заголовок и поля не мешают программе чтения с экрана.
            <div key={id} hidden={id !== tab} data-tab={id}>
              <TabVisibleContext value={id === tab && settings === null}>
                {/* Своя граница ожидания у каждой вкладки: чанк новой
                    вкладки не должен прятать уже открытые за скелетоном. */}
                <Suspense fallback={<TabSkeleton />}>
                  {id === "today" && (
                    <TodayScreen session={session} request={todayRequest} />
                  )}
                  {id === "diary" && (
                    <DiaryScreen session={session} request={diaryRequest} />
                  )}
                  {id === "dishes" && <DishesScreen session={session} />}
                  {id === "assistant" && <AssistantScreen session={session} />}
                </Suspense>
              </TabVisibleContext>
            </div>
          ))}
        </div>
        <TabBar items={tabs} active={tab} onSelect={select} />
      </div>
    </NavigateContext>
  );
}

/** Запрос, адресованный этой вкладке, в форме, которую она понимает. */
function narrow<T>(
  request: ScreenRequest<LaunchTarget> | null,
  tab: TabId,
  pick: (target: LaunchTarget & { tab: TabId }) => T,
): ScreenRequest<T> | null {
  if (request === null || !("tab" in request.target)) return null;
  if (request.target.tab !== tab) return null;
  return { id: request.id, target: pick(request.target) };
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
