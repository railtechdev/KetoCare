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
      // Вид дневника задаётся только там, где он нужен: иначе переход в другой
      // раздел тащил бы за собой чужой параметр.
      search={(previous) => ({ ...previous, kind: diaryKind })}
      className={className}
      activeProps={activeProps}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}
