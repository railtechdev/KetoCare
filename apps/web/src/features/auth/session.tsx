import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api, setAccessToken } from "../../lib/api";
import { isRole, type Role } from "./roles";

export interface Session {
  userId: string;
  role: Role;
  patientScope: string | null;
}

interface SessionState {
  session: Session | null;
  /** true, пока идёт первичное восстановление сессии из refresh-cookie */
  restoring: boolean;
  signIn: (accessToken: string) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * Разбирает claims access-токена.
 *
 * Только для отображения (какие пункты меню показать): подпись здесь не
 * проверяется, и доверять этому нельзя. Права проверяет сервер на каждом
 * запросе (правило 5 CLAUDE.md).
 */
export function readTokenClaims(token: string): Session | null {
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as Record<string, unknown>;

    if (typeof json.sub !== "string" || !isRole(json.role)) return null;

    return {
      userId: json.sub,
      role: json.role,
      patientScope:
        typeof json.patient_scope === "string" ? json.patient_scope : null,
    };
  } catch {
    return null;
  }
}

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

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (context === null) {
    throw new Error("useSession requires a SessionProvider ancestor");
  }
  return context;
}
