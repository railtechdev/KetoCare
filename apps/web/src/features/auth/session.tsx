import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api, onSessionExpired, setAccessToken } from "../../lib/api";
import { readTokenClaims, type Session } from "./claims";
import { SessionContext, type SessionState } from "./sessionContext";

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
    await api.POST("/api/v1/auth/logout", {});
    setAccessToken(null);
    setSession(null);
    queryClient.clear();
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
      const { data } = await api.POST("/api/v1/auth/refresh", { body: {} });
      if (cancelled) return;

      if (data?.access_token) {
        setAccessToken(data.access_token);
        setSession(readTokenClaims(data.access_token));
      }
      setRestoring(false);
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
