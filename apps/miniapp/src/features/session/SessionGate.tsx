import { EmptyState, ErrorState } from "@ketocare/ui";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { onSessionExpired } from "../../lib/api";
import { launchDiagnosis } from "../../lib/telegram";
import { LanguageSwitch } from "./LanguageSwitch";
import type { Session, SessionProblem } from "./useSession";
import { SessionUpdateContext, useOpenSession } from "./useSession";

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
  children: (
    session: Session,
    actions: { switchChild: (patientId: string) => void },
  ) => ReactNode;
}) {
  const { t } = useTranslation();
  const open = useOpenSession();
  const { mutate } = open;
  const queryClient = useQueryClient();

  // Переключение ребёнка (ADR-0048) — новая сессия, а не фильтр: кэш прежнего
  // ребёнка сбрасывается целиком, и экраны собираются заново под новым токеном.
  // Иначе на мгновение были бы видны данные одного ребёнка под именем другого.
  const switchChild = useCallback(
    (patientId: string) => {
      queryClient.clear();
      mutate({ switchTo: patientId });
    },
    [mutate, queryClient],
  );

  // Поправки к сессии после входа (`useUpdateSession`). Привязаны к ответу
  // входа: новый вход (другой ребёнок, перезапуск) их сбрасывает — он уже
  // несёт свежие значения с сервера.
  const [patched, setPatched] = useState<{
    base: Session;
    patch: Partial<Session>;
  } | null>(null);
  const opened = open.data;
  const updateSession = useCallback(
    (patch: Partial<Session>) => {
      if (opened === undefined) return;
      setPatched((prev) => ({
        base: opened,
        patch: prev?.base === opened ? { ...prev.patch, ...patch } : patch,
      }));
    },
    [opened],
  );
  const session = useMemo(
    () =>
      opened === undefined
        ? undefined
        : patched?.base === opened
          ? { ...opened, ...patched.patch }
          : opened,
    [opened, patched],
  );

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
    // `role="status"`: программа чтения с экрана объявляет ожидание, а не
    // молчит до первого экрана.
    return (
      <p role="status" className="p-section text-muted-foreground">
        {t("opening")}
      </p>
    );
  }

  if (open.isError) {
    // Язык — и на экранах, где приложение не открылось: объяснение на
    // непонятном языке оставляло бы человека без следующего шага (ADR-0052).
    // Сохранять выбор некуда — входа ещё нет.
    return (
      <div className="flex flex-col gap-section p-section">
        <LanguageSwitch persist={false} />
        <Problem problem={open.error} onRetry={() => open.mutate()} />
      </div>
    );
  }

  if (session === undefined) return null;
  return (
    <SessionUpdateContext value={updateSession}>
      {children(session, { switchChild })}
    </SessionUpdateContext>
  );
}

/** Три исхода неудачного входа — три текста, каждый со своим следующим шагом. */
function Problem({
  problem,
  onRetry,
}: {
  problem: SessionProblem;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  if (problem === "not_linked") {
    return (
      <EmptyState
        title={t("session.notLinked.title")}
        description={t("session.notLinked.description")}
      />
    );
  }

  if (problem === "relaunch") {
    // Кнопки «повторить» нет намеренно: повтор ушёл бы с той же устаревшей
    // подписью и кончился бы тем же отказом.
    return (
      <EmptyState
        title={t("session.relaunch.title")}
        description={t("session.relaunch.description")}
      />
    );
  }

  if (problem === "outside_telegram") {
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
              {!facts.telegram
                ? t("session.outside.noScript")
                : facts.launchParams
                  ? // Клиент открыл приложение как Mini App, но подписи среди
                    // параметров нет: обменивать на сессию нечего.
                    t("session.outside.noSignature")
                  : t("session.outside.byLink")}
            </span>
            <span className="text-xs">
              {t("session.outside.diagnosis", {
                telegram: facts.telegram ? yes : no,
                launchParams: facts.launchParams ? yes : no,
                keys: facts.keys || no,
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
      onRetry={onRetry}
    />
  );
}
