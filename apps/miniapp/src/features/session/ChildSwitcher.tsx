import { Button, NativeSelect } from "@ketocare/ui";
import { Settings } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { TelegramConfirmDialog } from "../../components/TelegramConfirmDialog";
import { hasUnsavedInput } from "../../lib/telegram";
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
  // Ребёнок, к которому просятся перейти при незаконченном вводе.
  const [asked, setAsked] = useState<string | null>(null);
  const askedName =
    session.children.find((child) => child.patientId === asked)?.name ?? "";

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
              const next = event.target.value;
              if (next === session.patientId) return;
              if (hasUnsavedInput()) setAsked(next);
              else onSwitch(next);
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
      <TelegramConfirmDialog
        open={asked !== null}
        onOpenChange={(open) => {
          if (!open) setAsked(null);
        }}
        title={t("child.switchTitle", { name: askedName })}
        description={t("child.switchBody", { name: session.patientName })}
        confirmLabel={t("child.switchConfirm")}
        cancelLabel={t("child.switchCancel")}
        onConfirm={() => {
          if (asked !== null) onSwitch(asked);
          setAsked(null);
        }}
      />
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
