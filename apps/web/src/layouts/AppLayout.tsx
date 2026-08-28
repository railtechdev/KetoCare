import { Outlet, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../components/SectionLink";
import { SECTIONS_BY_ROLE } from "../features/auth/roles";
import { useSession } from "../features/auth/useSession";
import { PatientSwitcher } from "../features/patients/PatientSwitcher";

/**
 * Каркас кабинета. Один билд на три роли (раздел 8.1 ТЗ): недоступные разделы
 * не рендерятся, но это только UX — доступ проверяет сервер.
 */
export function AppLayout() {
  const { t } = useTranslation();
  const { session, signOut } = useSession();
  const navigate = useNavigate();

  if (session === null) return null;

  const sections = SECTIONS_BY_ROLE[session.role];

  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-4 border-b border-border bg-card px-6 py-3 shadow-kc-sm">
        <span className="text-lg font-bold text-primary">{t("app.name")}</span>
        <span className="rounded-full border border-border bg-background px-2.5 py-0.5 text-sm text-muted-foreground">
          {t(`roles.${session.role}`)}
        </span>
        <div className="mr-auto">
          {session.role === "parent" && <PatientSwitcher />}
        </div>
        <button
          type="button"
          onClick={() => {
            void signOut().then(() => navigate({ to: "/login" }));
          }}
          className="min-h-touch rounded-lg border border-border px-4 text-foreground"
        >
          {t("nav.logout")}
        </button>
      </header>

      <div className="grid items-start gap-6 p-6 md:grid-cols-[220px_1fr]">
        <nav aria-label={t("app.name")}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {sections.map((section) => (
              <li key={section}>
                <SectionLink
                  section={section}
                  className="flex min-h-touch items-center rounded-lg px-3 text-foreground no-underline hover:bg-card"
                  activeProps={{ className: "bg-card font-semibold" }}
                >
                  {t(`nav.${section}`)}
                </SectionLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-h-[60vh] rounded-xl bg-card p-6 shadow-kc-sm">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
