import type { ReactNode } from "react";

/** Ошибка отправки формы. role=alert — сообщение объявляется сразу. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      className="mb-4 rounded-lg bg-destructive px-3 py-2.5 text-sm text-destructive-foreground"
      role="alert"
    >
      {children}
    </p>
  );
}
