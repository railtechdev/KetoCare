import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { Session } from "./useSession";

/**
 * Выбор ребёнка над экранами — когда Telegram ведёт нескольких (ADR-0048).
 *
 * Тот же приём, что у переключателя в шапке кабинета (`PatientSwitcher`):
 * обычный список, не рендерится при одном ребёнке — выбирать не из чего, а
 * лишний элемент отвлекает от того, ради чего приложение открыли.
 *
 * Выбор не фильтрует данные на месте, а открывает новую сессию, суженную до
 * выбранного ребёнка: экраны собираются заново, и данные одного ребёнка не
 * могут оказаться под именем другого.
 */
export function ChildSwitcher({
  session,
  onSwitch,
}: {
  session: Session;
  onSwitch: (patientId: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();

  if (session.children.length < 2) return null;

  return (
    <div className="flex items-center gap-field border-b border-border bg-card px-4 py-2">
      <label className="shrink-0 text-sm text-muted-foreground" htmlFor={id}>
        {t("child.label")}
      </label>
      <select
        id={id}
        value={session.patientId}
        onChange={(event) => {
          if (event.target.value !== session.patientId)
            onSwitch(event.target.value);
        }}
        className="min-h-(--spacing-touch) min-w-0 flex-1 rounded-xl border border-border bg-card px-3"
      >
        {session.children.map((child) => (
          <option key={child.patientId} value={child.patientId}>
            {child.name}
          </option>
        ))}
      </select>
    </div>
  );
}
