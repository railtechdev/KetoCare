import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { KitLabelsProvider, kitLabelsFrom } from "@ketocare/ui";

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

/**
 * Подписи предметных компонентов кита — из словаря кабинета, а не литералы
 * кита: те же компоненты стоят в двуязычном Mini App (ADR-0052).
 */
function KitLabels({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation("common");
  const labels = useMemo(
    () => kitLabelsFrom((key, values) => t(key, values)),
    // Язык — явная зависимость: `t` между языками может остаться той же ссылкой.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, i18n.language],
  );
  return <KitLabelsProvider labels={labels}>{children}</KitLabelsProvider>;
}

export function App() {
  return (
    <KitLabels>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </KitLabels>
  );
}
