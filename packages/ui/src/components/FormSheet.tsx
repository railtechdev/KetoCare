import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { cn } from "@ui/lib/cn";
import { Button } from "./ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";

export interface FormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /**
   * Подпись кнопки закрытия — из словаря экрана («Закрыть»).
   *
   * Обязательна, потому что кнопка кита подписана по-английски («Close») и
   * зачитывалась так в русском интерфейсе; своя кнопка стоит в строке
   * заголовка, а не поверх неё.
   */
  closeLabel: string;
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
const FOCUSABLE = [
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function FormSheet({
  open,
  onOpenChange,
  title,
  closeLabel,
  description,
  className,
  children,
}: FormSheetProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        showCloseButton={false}
        // Radix ставит фокус на первый фокусируемый элемент панели, а первой
        // теперь стоит кнопка закрытия в шапке. Фокус уходит к первому полю
        // тела, как было до переноса кнопки: иначе Enter по привычке закрывал
        // панель, в том числе с одноразовым временным паролем. Тело пустое —
        // фокус остаётся на кнопке закрытия.
        onOpenAutoFocus={(event) => {
          const first = bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE);
          if (!first) return;
          event.preventDefault();
          first.focus();
        }}
        className={cn("w-full overflow-y-auto sm:max-w-xl", className)}
      >
        {/* Кнопка закрытия — в строке заголовка, а не поверх него: встроенная
            кнопка кита стоит `absolute`, и длинный заголовок уходил под неё. */}
        <SheetHeader className="flex-row items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {/* Заголовок панели несёт имя («Профиль: …») — слово без пробелов
                не должно давать панели горизонтальную прокрутку. */}
            <SheetTitle className="break-words text-section-title">
              {title}
            </SheetTitle>
            {description && (
              <SheetDescription className="break-words">
                {description}
              </SheetDescription>
            )}
          </div>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-mt-1 -mr-2 shrink-0"
              aria-label={closeLabel}
            >
              <X aria-hidden="true" />
            </Button>
          </SheetClose>
        </SheetHeader>

        <div ref={bodyRef} className="flex flex-col gap-block px-4 pb-4">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
