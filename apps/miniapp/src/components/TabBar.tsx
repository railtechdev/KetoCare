import { cn } from "@ketocare/ui";
import type { LucideIcon } from "lucide-react";

/**
 * Нижняя полоса переходов.
 *
 * Внизу, а не сверху: приложение держат одной рукой, а сверху у Telegram своя
 * шапка с кнопкой закрытия — попасть мимо неё пальцем значит закрыть кабинет.
 *
 * Роутера здесь нет намеренно: экранов пять, адресной строки в Telegram не
 * видно, а глубокие ссылки внутрь приложения приходят не адресом, а параметром
 * запуска. Роутер добавил бы историю, которой некуда показываться.
 */
export interface TabBarItem<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

export function TabBar<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: readonly TabBarItem<T>[];
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <nav className="sticky bottom-0 border-t border-border bg-card pb-[var(--safe-bottom,0px)]">
      <ul className="flex">
        {items.map(({ id, label, icon: Icon }) => (
          <li key={id} className="flex-1">
            <button
              type="button"
              // Высота касания не меньше `--spacing-touch`: промах по вкладке
              // уводит с экрана, на котором семья отмечает съеденное.
              className={cn(
                "flex min-h-(--spacing-touch) w-full flex-col items-center gap-1 py-2",
                active === id ? "text-primary" : "text-muted-foreground",
              )}
              aria-current={active === id ? "page" : undefined}
              onClick={() => {
                onSelect(id);
              }}
            >
              <Icon aria-hidden className="size-5" />
              <span className="text-xs">{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
