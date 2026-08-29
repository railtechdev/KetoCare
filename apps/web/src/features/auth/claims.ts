import { isRole, type Role } from "./roles";

export interface Session {
  userId: string;
  role: Role;
  patientScope: string | null;
}

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
