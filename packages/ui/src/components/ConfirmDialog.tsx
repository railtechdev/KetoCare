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
  /**
   * Что именно подтверждается — подробностями под заголовком: перечень,
   * таблица. Отдельно от `description`, потому что описание кита — абзац, и
   * перечень внутри него был бы невалидной разметкой (`dl` в `p`).
   */
  children?: ReactNode;
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
  children,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent>
        {/* `wrap-anywhere`, а не `break-words`: окно и его шапка — сетка, и
            `break-word` не уменьшает минимальную ширину содержимого — название
            без пробелов («Удалить блюдо …») распирало окно шире телефона. */}
        <AlertDialogHeader>
          <AlertDialogTitle className="wrap-anywhere">{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription className="wrap-anywhere">
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          {/* Вариант — пропом, а не классами: `AlertDialogAction` кита — это
              `Button asChild`, и Slot склеивает классы без tailwind-merge.
              `bg-primary` варианта по умолчанию оставался рядом с
              `bg-destructive` и побеждал — опасное подтверждение было синим. */}
          <AlertDialogAction
            onClick={onConfirm}
            variant={destructive ? "destructive" : "default"}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
