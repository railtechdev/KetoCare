import { Button, cn } from "@ketocare/ui";
import { Trash2 } from "lucide-react";
import type { ComponentProps } from "react";

/**
 * «Убрать» / «Удалить» — один вид на всё приложение.
 *
 * Аудит насчитал четыре: серая кнопка-текст в меню, красная в дневнике,
 * обведённая у близких и значок корзины в расчёте. Одно и то же действие,
 * выглядящее по-разному, человек узнаёт заново на каждом экране. Теперь —
 * корзина и слово, цвет опасности, высота касания 44 px. `iconOnly` — там, где
 * строке не хватает ширины (строка продукта в расчёте): тогда слово уходит в
 * `aria-label`.
 */
export function RemoveButton({
  label,
  iconOnly = false,
  quiet = false,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "variant" | "size"> & {
  label: string;
  iconOnly?: boolean;
  /** Без красного: убрать можно, но это не главное действие на экране. */
  quiet?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={iconOnly ? "icon" : "sm"}
      className={cn(
        "min-h-touch shrink-0",
        quiet
          ? "text-muted-foreground hover:text-foreground"
          : "text-destructive hover:text-destructive",
        iconOnly && "min-w-(--spacing-touch)",
        className,
      )}
      {...(iconOnly && props["aria-label"] === undefined
        ? { "aria-label": label }
        : {})}
      {...props}
    >
      <Trash2 aria-hidden="true" className="size-4" />
      {!iconOnly && label}
    </Button>
  );
}
