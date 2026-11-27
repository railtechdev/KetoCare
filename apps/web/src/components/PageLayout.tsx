import { Button, DensityProvider, cn, type Density } from "@ketocare/ui";
import { ArrowLeft } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

export interface PageLayoutProps {
  title: string;
  /** Короткое пояснение под заголовком */
  intro?: ReactNode;
  /** Действия экрана — справа от заголовка */
  actions?: ReactNode;
  /** Возврат на предыдущий уровень; появляется только когда есть куда */
  onBack?: () => void;
  backLabel?: string;
  /**
   * Ширина — роль страницы, а не число (правило П34 канона):
   *
   * - `form` (42rem) — форма и связный текст: длинная строка читается плохо;
   *   колонка стоит по центру рабочей области;
   * - `content` (72rem) — одна колонка того, что читают; тоже по центру;
   * - `wide` — вся рабочая область, умолчание: страница, на которой работают;
   * - `full` — предела нет, ширину задают колонки внутри (панель, сводка).
   */
  width?: "form" | "content" | "wide" | "full";
  /**
   * Плотность экрана. Наследуется всеми блоками (`Section`) внутри — правило
   * П26 канона требует, чтобы экраны специалиста были плотнее родительских, и
   * до контекста это приходилось помнить в каждом блоке по отдельности.
   */
  density?: Density;
  children: ReactNode;
}

/** Классы записаны целиком: Tailwind ищет их в исходниках по тексту. */
const WIDTH = {
  // Узкая колонка стоит по центру рабочей области (правило П59). Прижатая
  // влево, она оставляла справа 40 % окна на ноутбуке и 70 % на мониторе
  // 2560 px — экран выглядел телефонной страницей в углу большого окна.
  form: "mx-auto w-full max-w-form",
  content: "mx-auto w-full max-w-content",
  // Рабочая страница занимает всю рабочую область: предел у области один на
  // весь кабинет (`max-w-shell` в `AppLayout`), и граница содержимого не
  // прыгает между разделами (docs/PLAN_UI_ORDER_2026-11.md, правило 1).
  wide: "max-w-none",
  full: "max-w-none",
} as const;

/**
 * Шаблон экрана: заголовок, пояснение, действия, возврат, ритм.
 *
 * Существует потому, что без него каждый экран решал это заново: заголовок был
 * 24 px на главной, 20 на калькуляторе и 18 внутри вкладок админки, вертикальный
 * ритм задавался тремя несогласованными системами, а ограничение ширины стояло
 * у четырёх экранов из тридцати. Возврат со второго уровня рисовался
 * рукописными кнопками в разных углах.
 *
 * Размеры берутся из токенов (`text-page-title`, `spacing-screen`), а не
 * выбираются на месте — правила П4 и П5 UI-канона.
 */
export function PageLayout({
  title,
  intro,
  actions,
  onBack,
  backLabel,
  width = "wide",
  density = "comfortable",
  children,
}: PageLayoutProps) {
  const { t } = useTranslation();
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);

  return (
    <ActionsSlotContext.Provider value={actionsSlot}>
      <DensityProvider density={density}>
        <div
          // Заголовок, пояснение и содержимое — в одной колонке, поэтому левая
          // линия у них общая при любой ширине. Страница либо занимает всю
          // рабочую область (`wide`, `full`), либо стоит в ней по центру
          // (`form`, `content`) — правило П59. Прежде узкая колонка была
          // прижата влево по образцу GOV.UK и NHS, но у них по центру стоит
          // сам контейнер страницы; у нас рабочая область — 112rem, и
          // прижатие внутри неё оставляло пустой больше половины окна.
          // Метка для сквозной проверки П59: колонка занимает область или
          // стоит по центру.
          data-page-width={width}
          className={cn("flex flex-col gap-screen", WIDTH[width])}
        >
          <header className="flex flex-col gap-section">
            {onBack && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 self-start"
                onClick={onBack}
              >
                <ArrowLeft aria-hidden="true" />
                {backLabel ?? t("actions.back")}
              </Button>
            )}

            <div className="flex flex-wrap items-start justify-between gap-section">
              <div className="min-w-64 flex-1">
                {/* `break-words`: заголовок часто несёт имя ребёнка или название
                  продукта из базы, а слово без пробелов длиннее экрана 360 px
                  выдавливало страницу вбок — `min-w-0` даёт колонке сжаться, но
                  переносить слово сам не умеет. */}
                <h1 className="m-0 break-words text-page-title font-semibold text-foreground">
                  {title}
                </h1>
                {intro && (
                  <p className="m-0 mt-1 max-w-3xl break-words text-sm text-muted-foreground">
                    {intro}
                  </p>
                )}
              </div>
              {/* Слот всегда в разметке: в него же приходят действия блока
                через `PageActions`. Пустой не занимает места (`empty:hidden`). */}
              <div
                ref={setActionsSlot}
                // `max-w-full`: без него блок действий не уже своего содержимого, и
                // на 360 px три кнопки уходили за край экрана вместо переноса.
                className="flex max-w-full shrink-0 flex-wrap items-center gap-field empty:hidden"
              >
                {actions}
              </div>
            </div>
          </header>

          {children}
        </div>
      </DensityProvider>
    </ActionsSlotContext.Provider>
  );
}

/**
 * `undefined` — экрана нет вовсе (блок отрисован сам по себе, как в тесте);
 * `null` — экран есть, но его шапка ещё не смонтирована.
 */
const ActionsSlotContext = createContext<HTMLDivElement | null | undefined>(
  undefined,
);

/**
 * Действие блока, которое по смыслу — первичное действие экрана (правило П31):
 * «Пригласить сотрудника» у учётных записей, «Добавить продукт» у справочника.
 *
 * Состояние, которое кнопка открывает (панель, правка), живёт в блоке, а место
 * кнопки — в шапке `PageLayout`. Раньше блок рисовал её у себя строкой под
 * заголовком экрана, и первичное действие оказывалось не там, где его ищут на
 * всех остальных экранах. Вне `PageLayout` (блок в тесте, вкладка) кнопки
 * рисуются на месте.
 */
export function PageActions({ children }: { children: ReactNode }) {
  const slot = useContext(ActionsSlotContext);

  if (slot === undefined) {
    return <div className="flex flex-wrap gap-field">{children}</div>;
  }
  return slot === null ? null : createPortal(children, slot);
}
