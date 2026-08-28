import { useContext } from "react";

import { SessionContext, type SessionState } from "./sessionContext";

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (context === null) {
    throw new Error("useSession requires a SessionProvider ancestor");
  }
  return context;
}
