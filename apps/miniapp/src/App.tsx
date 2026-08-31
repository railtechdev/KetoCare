import { useEffect } from "react";

import { HomeScreen } from "./features/home/HomeScreen";
import { SessionGate } from "./features/session/SessionGate";
import { applyTelegramTheme, watchTelegramTheme } from "./lib/theme";
import { webApp } from "./lib/telegram";

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
    <div className="min-h-dvh bg-background pt-[var(--safe-top,0px)] pb-[var(--safe-bottom,0px)]">
      <SessionGate>{(session) => <HomeScreen session={session} />}</SessionGate>
    </div>
  );
}
