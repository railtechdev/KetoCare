import { Button, NativeSelect } from "@ketocare/ui";
import { Settings } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { Session } from "./useSession";

/**
 * Шапка приложения: какой ребёнок открыт и вход в настройки.
 *
 * Над экранами, а не на одной вкладке: какой ребёнок открыт, важно на каждой —
 * запись в дневник уходит именно ему (ADR-0048). Детей два и больше — вместо
 * имени список (`NativeSelect` кита), как переключатель в шапке кабинета.
 *
 * Выбор не фильтрует данные на месте, а открывает новую сессию, суженную до
 * выбранного ребёнка: экраны собираются заново, и данные одного ребёнка не
 * могут оказаться под именем другого.
 *
 * Шестерёнка — вход в настройки и вне Telegram, и в старом клиенте, где
 * пункта «Настройки» в меню приложения нет (ADR-0075).
 */
export function ChildSwitcher({
  session,
  onSwitch,
  onOpenSettings,
}: {
  session: Session;
  onSwitch: (patientId: string) => void;
  onOpenSettings?: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const several = session.children.length >= 2;

  return (
    <header className="flex items-center gap-field border-b border-border bg-card px-4 py-1">
      {several ? (
        <>
          <label className="sr-only" htmlFor={id}>
            {t("child.label")}
          </label>
          <NativeSelect
            id={id}
            value={session.patientId}
            onChange={(event) => {
              if (event.target.value !== session.patientId)
                onSwitch(event.target.value);
            }}
            className="flex-1 font-semibold"
          >
            {session.children.map((child) => (
              <option key={child.patientId} value={child.patientId}>
                {child.name}
              </option>
            ))}
          </NativeSelect>
        </>
      ) : (
        // Имя ребёнка без пробелов не должно распирать шапку телефона.
        <p className="m-0 min-w-0 flex-1 truncate font-semibold">
          {session.patientName}
        </p>
      )}
      {onOpenSettings !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-(--spacing-touch) shrink-0"
          aria-label={t("settings.title")}
          onClick={onOpenSettings}
        >
          <Settings aria-hidden="true" className="size-5" />
        </Button>
      )}
    </header>
  );
}
