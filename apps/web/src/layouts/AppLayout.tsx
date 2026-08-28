import { Link, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { SECTIONS_BY_ROLE } from "../features/auth/roles";
import { useSession } from "../features/auth/useSession";

/**
 * Каркас кабинета. Один билд на три роли (раздел 8.1 ТЗ): недоступные разделы
 * не рендерятся, но это только UX — доступ проверяет сервер.
 */
export function AppLayout() {
  const { t } = useTranslation();
  const { session, signOut } = useSession();

  if (session === null) return null;

  const sections = SECTIONS_BY_ROLE[session.role];

  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-4 border-b border-line bg-surface px-6 py-3 shadow-kc-sm">
        <span className="text-lg font-bold text-accent">{t("app.name")}</span>
        <span className="mr-auto rounded-full border border-line bg-canvas px-2.5 py-0.5 text-sm text-muted">
          {t(`roles.${session.role}`)}
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="min-h-touch rounded-lg border border-line px-4 text-ink"
        >
          {t("nav.logout")}
        </button>
      </header>

      <div className="grid items-start gap-6 p-6 md:grid-cols-[220px_1fr]">
        <nav aria-label={t("app.name")}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {sections.map((section) => (
              <li key={section}>
                <Link
                  to="/app/$section"
                  params={{ section }}
                  className="flex min-h-touch items-center rounded-lg px-3 text-ink no-underline hover:bg-surface"
                  activeProps={{ className: "bg-surface font-semibold" }}
                >
                  {t(`nav.${section}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-h-[60vh] rounded-kc bg-surface p-6 shadow-kc-sm">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
