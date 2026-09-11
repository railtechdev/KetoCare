import type { ReactNode } from "react";

/**
 * Ошибка отправки формы. role=alert — сообщение объявляется сразу.
 *
 * Текст сервера называет объект («Продукт «…» уже есть в справочнике»), а
 * название бывает словом без пробелов — оно переносится, а не вылезает за
 * плашку.
 */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      className="mb-4 rounded-lg bg-destructive px-3 py-2.5 text-sm break-words text-destructive-foreground"
      role="alert"
    >
      {children}
    </p>
  );
}
