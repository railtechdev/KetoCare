import type { ReactNode } from "react";

/**
 * Блок сводки. Оформление повторяет `DiaryEntryCard` из packages/ui (та же
 * подложка, радиус и тень), чтобы карточки замеров и остальные блоки главной
 * читались одним рядом, а не как два разных интерфейса.
 */
export function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl bg-card p-4 text-foreground shadow-kc">
      <h2 className="m-0 text-base font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
