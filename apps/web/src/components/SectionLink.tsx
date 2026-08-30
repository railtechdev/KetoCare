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
  /** Объект, который нужно открыть в новом разделе (`?item=`) */
  item?: string;
  /** Строка поиска для нового раздела (`?q=`) */
  query?: string;
  /**
   * Пациент, чью карту нужно открыть.
   *
   * Обычно ребёнок переносится сам — семья ведёт одного. У врача пациентов
   * много, и очередь внимания на главной ведёт к конкретному: перенести здесь
   * нечего, нужно задать.
   */
  patient?: string;
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
  item,
  query,
  patient,
  onClick,
}: Props) {
  return (
    <Link
      to="/app/$section"
      params={{ section }}
      // Выбранный ребёнок переносится, состояние другого экрана — нет:
      // вкладка, объект и строка поиска принадлежат тому разделу, из которого
      // уходим, и на новом означали бы уже другое (`?tab=verify` калькулятора
      // приезжал на главную, а `?item=` карточки продукта — куда угодно).
      // Поэтому все они гасятся по умолчанию и задаются явно там, где нужны:
      // справочник открывает калькулятор на своём продукте (`item`), а
      // калькулятор ведёт в справочник со своим запросом (`query`).
      search={(previous) => ({
        ...previous,
        tab: undefined,
        kind: diaryKind,
        item,
        q: query,
        patient: patient ?? previous.patient,
      })}
      className={className}
      activeProps={activeProps}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}
