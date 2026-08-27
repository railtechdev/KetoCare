import { useTranslation } from "react-i18next";

import { LoginForm } from "./features/auth/LoginForm";
import { SessionProvider, useSession } from "./features/auth/session";
import { AppLayout } from "./layouts/AppLayout";

function Shell() {
  const { t } = useTranslation();
  const { session, restoring } = useSession();

  if (restoring) {
    return <p role="status">{t("app.loading")}</p>;
  }

  if (session === null) {
    return <LoginForm />;
  }

  return (
    <AppLayout>
      {/* Экраны разделов подключаются следующими задачами этапа 2 (пп. 10-14 ТЗ) */}
      <p>{t("app.name")}</p>
    </AppLayout>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
