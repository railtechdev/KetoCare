import { useTranslation } from "react-i18next";

import { SECTIONS_BY_ROLE, type Role } from "../features/auth/roles";
import { useSession } from "../features/auth/session";

interface Props {
  children: React.ReactNode;
}

/**
 * Общий каркас кабинета. Один билд на три роли (раздел 8.1 ТЗ): недоступные
 * разделы не рендерятся, но это только UX — доступ проверяет сервер.
 */
export function AppLayout({ children }: Props) {
  const { t } = useTranslation();
  const { session, signOut } = useSession();

  if (session === null) return null;

  const sections = SECTIONS_BY_ROLE[session.role as Role];

  return (
    <div className="kc-app">
      <header className="kc-app__header">
        <span className="kc-app__brand">{t("app.name")}</span>
        <span className="kc-app__role">{t(`roles.${session.role}`)}</span>
        <button type="button" onClick={() => void signOut()}>
          {t("nav.logout")}
        </button>
      </header>

      <div className="kc-app__body">
        <nav className="kc-app__nav" aria-label={t("app.name")}>
          <ul>
            {sections.map((section) => (
              <li key={section}>
                <a href={`/app/${section}`}>{t(`nav.${section}`)}</a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="kc-app__main">{children}</main>
      </div>
    </div>
  );
}
