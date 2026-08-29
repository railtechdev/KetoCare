import type { ReactNode } from "react";

/**
 * Заголовок содержимого вкладки — уровнем ниже шапки экрана.
 *
 * Подраздел за вкладкой — это не отдельный экран: второго `h1` на странице быть
 * не должно, но и безымянным содержимое вкладки оставлять нельзя. Размеры
 * берутся из токенов, а не подбираются в каждой панели заново (правила П4, П5,
 * П24 канона).
 *
 * Не путать с `Section` из `packages/ui`: тот выделяет **блок** внутри экрана
 * рамкой и заголовком, этот — только озаглавливает содержимое вкладки.
 */
export function SubPageHeader({
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
