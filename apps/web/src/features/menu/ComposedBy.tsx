import { formatDayTime } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import type { MenuRead } from "./useMenu";

/**
 * «Составил(а): Имя, дд.мм чч:мм» — кто последним сохранил состав дня (ADR-0047).
 *
 * День составляют и семья, и ведущий специалист. Без этой строки план,
 * поменянный другим человеком, выглядел бы как свой: семья готовила бы по
 * нему, не зная, что его правили, а врач не отличал бы свой план от
 * семейного. Отметка «съедено» строку не меняет — она про еду, а не про план.
 *
 * Ничего не рисует, если автор неизвестен: дни, сохранённые до появления
 * отметки, автора не помнят, и угадывать его нельзя.
 */
export function ComposedBy({ menu }: { menu: MenuRead }) {
  const { t } = useTranslation("menu");

  // Поле может отсутствовать во время выката: фронт какое-то время говорит со
  // старым API, и строка в этом случае просто не появляется.
  if (!menu.updated_by_name) return null;

  return (
    <p className="m-0 text-sm text-muted-foreground">
      {t("composedBy", {
        name: menu.updated_by_name,
        when: formatDayTime(new Date(menu.updated_at)),
      })}
    </p>
  );
}
