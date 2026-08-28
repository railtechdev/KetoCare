import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { SessionProvider } from "./features/auth/session";
import { useSession } from "./features/auth/useSession";
import { router } from "./router";

function Shell() {
  const { t } = useTranslation();
  const { session, restoring } = useSession();

  // Роутер получает сессию пропом контекста, но сам `beforeLoad` при её смене не
  // перевычисляет: без явной инвалидации вход оставался на форме входа (сессия
  // уже есть, guard `/login` этого не видит), а выход — в кабинете. Особенно
  // заметно это было на первичной настройке 2FA у врача: сервер выдавал токены,
  // экран не менялся, и войти удавалось только перезагрузкой страницы вручную.
  //
  // Эффект, а не вызов рядом с signIn(): к моменту его выполнения новый контекст
  // уже отдан роутеру, поэтому порядок ни от чего не зависит — и переходы после
  // входа, выхода и настройки 2FA чинятся одним местом, а не тремя.
  useEffect(() => {
    // Пока сессия восстанавливается, роутер ещё не смонтирован и держит
    // начальный контекст с session === null. Инвалидация в этот момент
    // прогоняет guard'ы по нему и уводит на /login прямую ссылку вида
    // /app/products — открытая по закладке страница подменялась первым разделом
    // роли.
    if (restoring) return;
    void router.invalidate();
  }, [session, restoring]);

  // Роутер не монтируется, пока сессия восстанавливается из refresh-cookie:
  // иначе guard'ы увидели бы session === null и увели на /login того, кто уже вошёл.
  if (restoring) {
    return (
      <p role="status" className="p-6 text-muted-foreground">
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
