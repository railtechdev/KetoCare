import { EmptyState, ErrorState } from "@ketocare/ui";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { onSessionExpired } from "../../lib/api";
import { launchDiagnosis } from "../../lib/telegram";
import type { Session } from "./useSession";
import { useOpenSession } from "./useSession";

/**
 * Открывает сессию до того, как показать хоть один экран.
 *
 * Три исхода, и каждый ведёт к своему тексту: приложение открыто не из
 * Telegram, чат не привязан, вход не удался. Общее «ошибка входа» на все три
 * оставляло бы семью гадать, что делать: в двух случаях из трёх делать нужно
 * разное, а в одном — ничего, кроме как повторить.
 */
export function SessionGate({
  children,
}: {
  children: (session: Session) => ReactNode;
}) {
  const { t } = useTranslation();
  const open = useOpenSession();
  const { mutate } = open;

  useEffect(() => {
    mutate();
    // Истечение сессии посреди работы — прежде всего отзыв привязки: refresh
    // умирает, и каждый экран показывал «проверьте связь», хотя связь ни при
    // чём. Вход открывается заново тем же путём, что при запуске: подпись
    // Telegram ещё жива — семья ничего не замечает; привязка отозвана —
    // честный экран «этот Telegram ещё не привязан».
    return onSessionExpired(() => {
      mutate();
    });
  }, [mutate]);

  if (open.isPending || open.isIdle) {
    return <p className="p-block text-muted-foreground">{t("opening")}</p>;
  }

  if (open.isError) {
    if (open.error === "not_linked") {
      return (
        <EmptyState
          title={t("session.notLinked.title")}
          description={t("session.notLinked.description")}
        />
      );
    }

    if (open.error === "outside_telegram") {
      // Две причины выглядят снаружи одинаково, а лечатся по-разному: страницу
      // открыли ссылкой (Telegram есть, подписи нет) или не загрузился скрипт
      // Telegram (нет и объекта). Поэтому под текстом стоит строка проверки —
      // без неё разбор превращается в переписку вслепую.
      const facts = launchDiagnosis();
      const yes = t("session.outside.yes");
      const no = t("session.outside.no");

      return (
        <EmptyState
          title={t("session.outside.title")}
          description={
            <span className="flex flex-col gap-field">
              <span>{t("session.outside.description")}</span>
              <span>
                {facts.telegram
                  ? t("session.outside.byLink")
                  : t("session.outside.noScript")}
              </span>
              <span className="text-xs">
                {t("session.outside.diagnosis", {
                  telegram: facts.telegram ? yes : no,
                  launchParams: facts.launchParams ? yes : no,
                })}
              </span>
            </span>
          }
        />
      );
    }

    return (
      <ErrorState
        title={t("session.failed.title")}
        description={t("session.failed.description")}
        retryLabel={t("actions.retry")}
        onRetry={() => {
          open.mutate();
        }}
      />
    );
  }

  return <>{children(open.data)}</>;
}
