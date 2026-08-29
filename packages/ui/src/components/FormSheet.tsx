import type { ReactNode } from "react";

import { cn } from "@ui/lib/cn";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";

export interface FormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Панель с формой добавления или правки — не уводя со списка.
 *
 * Существует потому, что одна и та же задача решалась пятью способами:
 * отдельным экраном вместо списка, формой, раскрытой над списком, формой под
 * списком, формой внутри карточки и формой под таблицей — с пятью разными
 * формами состояния (`docs/AUDIT_UI_LAYOUT.md`). Правило П32 канона оставляет
 * один: список первым, форма — панелью по первичному действию шапки.
 *
 * На телефоне панель занимает ширину экрана целиком, на большом — колонку
 * справа: форма родителя проверяется на 360 px, и узкая панель кита (`sm`)
 * там оставила бы поля в две трети экрана.
 *
 * Отдельным экраном остаётся то, что экраном и является: объект со своим
 * адресом (рецепт, продукт, ребёнок) — правило П29.
 */
export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  className,
  children,
}: FormSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={cn("w-full overflow-y-auto sm:max-w-xl", className)}
      >
        <SheetHeader className="gap-1">
          <SheetTitle className="text-section-title">{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>

        <div className="flex flex-col gap-block px-4 pb-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
