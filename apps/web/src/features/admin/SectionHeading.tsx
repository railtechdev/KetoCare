import type { ReactNode } from "react";

/**
 * Заголовок панели внутри вкладки админки.
 *
 * Повторяет шапку `PageLayout` уровнем ниже: подраздел админки — это не
 * отдельный экран, у него нет своего URL, и второго `h1` на странице быть не
 * должно. Размеры берутся из токенов (`text-section-title`), а не подбираются
 * в каждой панели заново — правила П4 и П5 UI-канона.
 */
export function SectionHeading({
  title,
  intro,
  actions,
}: {
  title: string;
  intro?: ReactNode;
  /** Действия панели — справа от заголовка */
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-block">
      <div className="min-w-0">
        <h2 className="m-0 text-section-title font-semibold text-foreground">
          {title}
        </h2>
        {intro && (
          <p className="m-0 mt-1 text-sm text-muted-foreground">{intro}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-field">{actions}</div>
      )}
    </div>
  );
}
