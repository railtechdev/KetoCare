import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api, setAccessToken } from "../../lib/api";
import { readTokenClaims, type Session } from "./claims";
import { SessionContext, type SessionState } from "./sessionContext";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);

  const signIn = useCallback((accessToken: string) => {
    setAccessToken(accessToken);
    setSession(readTokenClaims(accessToken));
  }, []);

  const signOut = useCallback(async () => {
    await api.POST("/api/v1/auth/logout", {});
    setAccessToken(null);
    setSession(null);
  }, []);

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
