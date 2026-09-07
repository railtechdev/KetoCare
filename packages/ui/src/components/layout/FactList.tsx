import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export interface FactListProps {
  /** Подпись перечня для скринридера, если видимого заголовка над ним нет */
  label?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Пары «подпись — значение» строками: подпись слева, значение справа.
 *
 * Отличие от `MetricRow` — в вопросе, на который отвечает блок. `MetricRow` —
 * «сколько», плитками, значение крупно: его читают взглядом, сравнивая.
 * `FactList` — «какой», строками: паспорт продукта, состав назначения, ответы
 * анкеты. Их читают подряд, и подпись рядом со значением экономит высоту.
 *
 * Свой контейнер (`@container` на обёртке) — чтобы решение о двух колонках
 * зависело от ширины САМОГО перечня, а не окна и не соседнего блока. Раньше это
 * место было записано как `sm:grid-cols-[auto_1fr]` в шести файлах, слово в
 * слово: в узкой колонке на широком мониторе все шесть оставались
 * двухколоночными, и подпись с значением сходились в 90 px.
 */
export function FactList({ label, className, children }: FactListProps) {
  return (
    <div className={cn("@container", className)}>
      <dl
        aria-label={label}
        className="m-0 grid gap-x-6 gap-y-1 text-sm @sm:grid-cols-[auto_1fr] @sm:justify-start"
      >
        {children}
      </dl>
    </div>
  );
}

export interface FactProps {
  label: ReactNode;
  /** Значение; `null` — сведений нет, прочерк ставит компонент */
  value: ReactNode;
  /** Значение в несколько строк: переносы сохраняются */
  multiline?: boolean;
}

/**
 * Одна пара. Возвращает `dt` и `dd` без обёртки — иначе они перестанут быть
 * ячейками сетки перечня и встанут в одну колонку.
 *
 * `tabular-nums` всегда: на пропорциональных цифрах столбец значений прыгает по
 * горизонтали, и сравнить соседние строки глазом становится нельзя. На тексте
 * свойство ничего не меняет.
 */
export function Fact({ label, value, multiline = false }: FactProps) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn("m-0 tabular-nums", multiline && "whitespace-pre-line")}
      >
        {value ?? "—"}
      </dd>
    </>
  );
}
