import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  api,
  isTransient,
  onSessionExpired,
  setAccessToken,
} from "../../lib/api";
import { readTokenClaims, type Session } from "./claims";
import { SessionContext, type SessionState } from "./sessionContext";
import { clearTabStorage } from "../../lib/tabStorage";

/** Паузы перед повторами восстановления сессии: в сумме около минуты. */
const RESTORE_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);
  const queryClient = useQueryClient();

  /**
   * Кэш запросов принадлежит сессии и очищается вместе с ней.
   *
   * Без этого данные прежнего пользователя оставались на экране после смены
   * учётной записи: сервер новому родителю чужого ребёнка не отдаёт (403), но
   * TanStack Query показывал уже загруженный ответ, и одна семья видела карту
   * другой. Ошибки при этом не возникало — экран выглядел исправным.
   */
  const signIn = useCallback(
    (accessToken: string) => {
      queryClient.clear();
      setAccessToken(accessToken);
      setSession(readTokenClaims(accessToken));
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    // Сессия на устройстве гасится ВСЕГДА, даже если сервер не ответил.
    //
    // Порядок был обратным, и при недоступном сервере запрос отклонялся
    // исключением — до очистки дело не доходило вовсе. Человек нажимал «Выйти»
    // на чужом компьютере, видел, что ничего не произошло, и уходил: кабинет
    // ребёнка оставался открытым.
    //
    // Серверная часть выхода (сброс refresh-cookie) при этом всё равно нужна —
    // поэтому запрос отправляется, но его отказ ничего не отменяет.
    try {
      await api.POST("/api/v1/auth/logout", {});
    } catch {
      // Отказ сети. Локальная сессия гасится ниже в любом случае.
    } finally {
      setAccessToken(null);
      setSession(null);
      queryClient.clear();
      clearTabStorage();
    }
  }, [queryClient]);

  useEffect(() => {
    // Сессия истекла окончательно: refresh-cookie больше не принимается.
    // Клиент API к этому моменту уже попытался обновиться и не смог, поэтому
    // здесь остаётся увести человека на вход — иначе он остаётся в кабинете,
    // где каждый запрос отвечает отказом, и не понимает, почему.
    return onSessionExpired(() => {
      setSession(null);
      queryClient.clear();
    });
  }, [queryClient]);

  useEffect(() => {
    // Access-токен живёт только в памяти, поэтому после перезагрузки страницы
    // сессия восстанавливается по httpOnly refresh-cookie.
    let cancelled = false;

    void (async () => {
      // Отказ сети здесь ничего не восстанавливает, но и не должен оставлять
      // приложение в подвешенном состоянии. Без перехвата обещание
      // отклонялось, `setRestoring(false)` не выполнялся вовсе — и кабинет при
      // недоступном сервере навсегда застревал на «восстанавливаем сессию»,
      // не пуская даже на страницу входа.
      try {
        // «Слишком часто» и сбой сервера о сессии ничего не говорят: прежде
        // после них кабинет показывал экран входа человеку, который из него не
        // выходил (аудит адаптации 27.11.2026, А11). Повтор с нарастающей
        // паузой укладывается в минуту — окно лимита обновления на сервере.
        for (let attempt = 0; ; attempt++) {
          const { data, response } = await api.POST("/api/v1/auth/refresh", {
            body: {},
          });
          if (cancelled) return;

          if (data?.access_token) {
            setAccessToken(data.access_token);
            setSession(readTokenClaims(data.access_token));
            break;
          }
          if (
            response === undefined ||
            !isTransient(response.status) ||
            attempt >= RESTORE_DELAYS_MS.length
          ) {
            break;
          }
          await new Promise((resolve) =>
            setTimeout(resolve, RESTORE_DELAYS_MS[attempt]),
          );
          if (cancelled) return;
        }
      } catch {
        // Сервер недоступен: сессии нет, но экран входа человеку доступен.
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<SessionState>(
    () => ({ session, restoring, signIn, signOut }),
    [session, restoring, signIn, signOut],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
