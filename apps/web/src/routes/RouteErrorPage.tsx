import { Button, ErrorState } from "@ketocare/ui";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  isChunkLoadError,
  reloadOnceForChunkError,
  sessionStore,
} from "./chunkReload";

/**
 * Ошибка при показе раздела — вместо английской заглушки маршрутизатора.
 *
 * Самый частый повод — не догрузилась часть приложения (после выката или без
 * сети): тогда страница один раз перезагружается сама (`chunkReload.ts`). Если
 * и это не помогло — объяснение по-русски и два выхода: обновить страницу или
 * вернуться в кабинет.
 */
export function RouteErrorPage({ error }: ErrorComponentProps) {
  const { t } = useTranslation("common");
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (
      reloadOnceForChunkError(error, sessionStore(), () =>
        window.location.reload(),
      )
    ) {
      setReloading(true);
    }
  }, [error]);

  if (reloading) return null;

  const chunk = isChunkLoadError(error);

  return (
    <div className="flex min-h-dvh items-center justify-center p-screen">
      <div className="flex w-full max-w-form flex-col gap-section">
        <h1 className="sr-only">{t("routeError.title")}</h1>
        <ErrorState
          title={t("routeError.title")}
          description={chunk ? t("routeError.chunkBody") : t("routeError.body")}
          retryLabel={t("routeError.reload")}
          onRetry={() => window.location.reload()}
        />
        <Button asChild variant="outline" className="min-h-touch self-start">
          <a href="/app">{t("routeError.toApp")}</a>
        </Button>
      </div>
    </div>
  );
}
