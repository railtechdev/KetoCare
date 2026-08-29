import type { ReactNode } from "react";

import { Section } from "@ketocare/ui";

/**
 * Блок сводки главной.
 *
 * Существует только ради подписи действия справа и общего вида блоков главной;
 * всё остальное берётся у `Section` из `packages/ui` — единственного способа
 * выделить блок внутри экрана (правило П23 канона). Своей разметки здесь нет.
 */
export function Panel({
  title,
  action,
  className,
  children,
}: {
  title: string;
  /** Ссылка или кнопка в правом верхнем углу блока */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Section title={title} action={action} className={className}>
      {children}
    </Section>
  );
}
