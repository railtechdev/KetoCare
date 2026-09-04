import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { buttonVariants } from "./ui/button";
import { cn } from "../lib/cn";

export interface ConfirmDialogProps {
  /**
   * Кнопка, открывающая диалог. Не нужна в управляемом режиме: там диалог
   * открывает не нажатие, а отправка формы.
   */
  trigger?: ReactNode;
  /**
   * Управляемый режим. Нужен там, где подтверждение вызывает не кнопка, а
   * submit формы: собственного триггера у такой формы нет, а подтверждать
   * необратимое действие двумя разными диалогами нельзя.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Называет объект: «Удалить запись за 27.08?», а не «Вы уверены?» */
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** Оформлять подтверждение как опасное действие */
  destructive?: boolean;
  onConfirm: () => void;
}

/**
 * Подтверждение необратимого действия.
 *
 * Один диалог на всё приложение. Раньше подтверждение делалось инлайновой
 * подменой кнопок и было написано дважды независимо: в одном месте оно
 * называло объект, в другом спрашивало «уверены?», а фокус и клавиша Esc
 * работали по-разному.
 *
 * Заголовок обязан называть объект: пользователь подтверждает, что понял, что
 * именно исчезнет, а не нажимает «да» по привычке.
 */
export function ConfirmDialog({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = true,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(
              destructive && buttonVariants({ variant: "destructive" }),
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
