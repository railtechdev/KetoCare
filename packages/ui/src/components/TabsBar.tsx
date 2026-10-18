import type { ReactNode } from "react";

import { cn } from "@ui/lib/cn";
import { TabsList, TabsTrigger } from "./ui/tabs";

export interface TabsBarItem {
  value: string;
  label: string;
  badge?: ReactNode;
}

export interface TabsBarProps {
  /** Подпись набора вкладок для скринридера */
  label: string;
  items: readonly TabsBarItem[];
  className?: string;
}

/**
 * Полоса вкладок — одно оформление на всё приложение.
 *
 * До неё на шесть наборов вкладок приходилось четыре разных набора классов и
 * три разных ответа на «что делать, когда вкладки не помещаются»: перенос по
 * строкам, горизонтальный скролл и растягивание на ширину
 * (`docs/AUDIT_UI_LAYOUT.md`). Ответ здесь один — перенос по строкам: полоса
 * со скроллом прячет вкладки, а спрятанную вкладку не находят.
 *
 * Ставится внутрь `<Tabs>`; значение вкладки держит вызывающий экран и обязан
 * хранить его в адресе (правило П30 канона).
 */
export function TabsBar({ label, items, className }: TabsBarProps) {
  return (
    <TabsList
      aria-label={label}
      variant="line"
      className={cn(
        "w-full flex-wrap justify-start gap-1 border-b border-border group-data-[orientation=horizontal]/tabs:h-auto",
        className,
      )}
    >
      {items.map((item) => (
        <TabsTrigger
          key={item.value}
          value={item.value}
          className="min-h-touch flex-none gap-2 px-4"
        >
          <span>{item.label}</span>
          {item.badge !== undefined && item.badge !== null && (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-xs font-semibold text-foreground tabular-nums group-data-[state=active]:bg-primary/15 group-data-[state=active]:text-primary">
              {item.badge}
            </span>
          )}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
