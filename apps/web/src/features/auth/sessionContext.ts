import { createContext } from "react";

import type { Session } from "./claims";

export interface SessionState {
  session: Session | null;
  /** true, пока идёт первичное восстановление сессии из refresh-cookie */
  restoring: boolean;
  signIn: (accessToken: string) => void;
  signOut: () => Promise<void>;
}

/**
 * Контекст вынесен из файла с провайдером: файл, экспортирующий и компонент,
 * и не-компонент, ломает гранулярность fast refresh.
 */
export const SessionContext = createContext<SessionState | null>(null);
