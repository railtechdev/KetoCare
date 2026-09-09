import { createContext, useContext } from "react";

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

/**
 * Сессия там, где её может не быть.
 *
 * `useSession` бросает исключение без провайдера — и правильно делает: экран,
 * которому нужен пользователь, не должен молча работать без него. Но есть
 * компоненты, которые лишь УКРАШАЮТ поведение по роли: поиск продукта
 * предлагает «искать в рецептах» только тем, у кого этот раздел есть. Такому
 * компоненту отсутствие провайдера — не ошибка (он живёт и в тестах, и в
 * витрине `/dev/ui`), а причина выбрать безопасный вариант: не предлагать.
 *
 * Живёт рядом с контекстом, а не рядом с `useSession`: девять тестов подменяют
 * тот модуль целиком, и новый экспорт в нём ронял их все — при том что к их
 * предмету он отношения не имеет.
 */
export function useOptionalSession(): SessionState | null {
  return useContext(SessionContext);
}
