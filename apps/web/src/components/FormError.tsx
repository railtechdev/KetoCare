import type { ReactNode } from "react";

/**
 * Ошибка отправки формы. role=alert — сообщение объявляется сразу.
 *
 * Текст сервера называет объект («Продукт «…» уже есть в справочнике»), а
 * название бывает словом без пробелов — оно переносится, а не вылезает за
 * плашку. `wrap-anywhere`, а не `break-words`: в колонке `items-start`
 * (калькулятор) ширина плашки берётся по содержимому, и уменьшает её по
 * самому длинному слову только `anywhere`.
 */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      className="mb-4 rounded-lg bg-destructive px-3 py-2.5 text-sm wrap-anywhere text-destructive-foreground"
      role="alert"
    >
      {children}
    </p>
  );
}
