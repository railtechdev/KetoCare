import { ConfirmDialog, type ConfirmDialogProps } from "@ketocare/ui";
import { useState } from "react";

import { useTelegramBack } from "../lib/useTelegram";

/**
 * `ConfirmDialog` кита, который закрывается кнопкой «Назад» Telegram.
 *
 * Без неё аппаратная «Назад» на Android при открытом подтверждении закрывала
 * весь Mini App — а не диалог, который человек видит перед собой.
 * Подтверждения Mini App ставятся только через эту обёртку.
 */
export function TelegramConfirmDialog({
  open: controlledOpen,
  onOpenChange,
  ...props
}: ConfirmDialogProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };

  useTelegramBack(open ? () => setOpen(false) : null);

  return <ConfirmDialog {...props} open={open} onOpenChange={setOpen} />;
}
