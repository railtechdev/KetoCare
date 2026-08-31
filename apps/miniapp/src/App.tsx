import { ChartLine, House, UtensilsCrossed } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { TabBar, type TabBarItem } from "./components/TabBar";
import { ChartsScreen } from "./features/charts/ChartsScreen";
import { HomeScreen } from "./features/home/HomeScreen";
import { MenuScreen } from "./features/menu/MenuScreen";
import { SessionGate } from "./features/session/SessionGate";
import type { Session } from "./features/session/useSession";
import { webApp } from "./lib/telegram";
import { applyTelegramTheme, watchTelegramTheme } from "./lib/theme";

type TabId = "home" | "menu" | "charts";

/**
 * Mini App: кабинет родителя внутри Telegram (раздел 9 ТЗ).
 *
 * Врачебного и административного здесь нет ничего — ни по замыслу, ни по
 * доступу: сессия сужена до одного ребёнка (ADR-0017).
 */
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
    { id: "charts", label: t("tabs.charts"), icon: ChartLine },
  ];

  return (
    <>
      <div className="flex-1">
        {tab === "home" && <HomeScreen session={session} />}
        {tab === "menu" && <MenuScreen session={session} />}
        {tab === "charts" && <ChartsScreen session={session} />}
      </div>
      <TabBar items={tabs} active={tab} onSelect={setTab} />
    </>
  );
}
