import { cn } from "@ketocare/ui";
import type { LucideIcon } from "lucide-react";

/**
 * Нижняя полоса переходов.
 *
 * Внизу, а не сверху: приложение держат одной рукой, а сверху у Telegram своя
 * шапка с кнопкой закрытия — попасть мимо неё пальцем значит закрыть кабинет.
 *
 * Роутера здесь нет намеренно: экранов четыре, адресной строки в Telegram не
 * видно, а глубокие ссылки внутрь приложения приходят не адресом, а параметром
 * запуска (`lib/launchTarget.ts`). Роутер добавил бы историю, которой некуда
 * показываться.
 *
 * Высота полосы постоянная — 4rem: к ней прижимается поле вопроса помощнику
 * (`sticky` над полосой), и плавающая высота сдвигала бы его.
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
    <nav className="sticky bottom-0 z-20 border-t border-border bg-card/95 pb-[var(--safe-bottom,0px)] backdrop-blur-xs">
      <ul className="flex">
        {items.map(({ id, label, icon: Icon }) => (
          <li key={id} className="flex-1">
            <button
              type="button"
              // Выбранная — цветом акцента Telegram (Bot API 7.0), если он
              // прошёл проверку контраста (`theme.ts`), иначе нашим.
              className={cn(
                "flex h-16 w-full flex-col items-center justify-center gap-1",
                active === id
                  ? "text-[var(--tg-accent,var(--color-primary))]"
                  : "text-muted-foreground",
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
