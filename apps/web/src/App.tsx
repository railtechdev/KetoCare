import { RouterProvider } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { SessionProvider } from "./features/auth/session";
import { useSession } from "./features/auth/useSession";
import { router } from "./router";

function Shell() {
  const { t } = useTranslation();
  const { session, restoring } = useSession();

  // Роутер не монтируется, пока сессия восстанавливается из refresh-cookie:
  // иначе guard'ы увидели бы session === null и увели на /login того, кто уже вошёл.
  if (restoring) {
    return (
      <p role="status" className="p-6 text-muted">
        {t("app.loading")}
      </p>
    );
  }

  return <RouterProvider router={router} context={{ session }} />;
}

export function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
