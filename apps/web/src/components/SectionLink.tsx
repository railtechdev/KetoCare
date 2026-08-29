import { Link } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";

type LinkProps = ComponentProps<typeof Link>;

interface Props {
  section: string;
  children: ReactNode;
  className?: string;
  activeProps?: LinkProps["activeProps"];
  /** Вид дневника, который нужно открыть сразу (для быстрых действий главной) */
  diaryKind?: string;
  onClick?: () => void;
}

/**
 * Ссылка на раздел кабинета.
 *
 * Существует ради переноса параметров адреса. Выбранный ребёнок живёт в адресе
 * (`?patient=`), а TanStack Router по умолчанию параметры поиска при переходе не
 * переносит: без этого родитель двоих детей терял выбор на каждом переходе
 * между разделами и снова упирался в «выберите ребёнка».
 *
 * Обычный `Link` использовать не запрещено, но про перенос параметров в нём
 * нужно помнить каждый раз — а забывается это молча, без ошибки сборки.
 */
export function SectionLink({
  section,
  children,
  className,
  activeProps,
  diaryKind,
  onClick,
}: Props) {
  return (
    <Link
      to="/app/$section"
      params={{ section }}
      // Выбранный ребёнок переносится, состояние другого экрана — нет:
      // вкладка и вид записей принадлежат тому разделу, из которого уходим, и
      // на новом означали бы уже другое (`?tab=verify` калькулятора приезжал
      // на главную). Вид дневника задаётся явно там, где он нужен.
      search={(previous) => ({ ...previous, tab: undefined, kind: diaryKind })}
      className={className}
      activeProps={activeProps}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}
