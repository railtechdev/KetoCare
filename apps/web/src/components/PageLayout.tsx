import { Button, cn } from "@ketocare/ui";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
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
  /** Форма или узкий текст читаются лучше в колонке ограниченной ширины */
  width?: "content" | "form";
  children: ReactNode;
}

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
  width = "content",
  children,
}: PageLayoutProps) {
  const { t } = useTranslation();

  return (
    <div
      // Колонка прижата влево, а не по центру: у заголовка, пояснения и полей
      // должна быть общая левая линия. Отцентрованная форма шириной 672 px в
      // области 1256 px оставляла по 290 px пустоты с каждой стороны — именно
      // это читается как «много воздуха». Так же поступают GOV.UK и NHS.
      className={cn(
        "flex flex-col gap-screen",
        width === "form" ? "max-w-form" : "max-w-content",
      )}
    >
      <header className="flex flex-col gap-block">
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

        <div className="flex flex-wrap items-start justify-between gap-block">
          <div className="min-w-0">
            <h1 className="m-0 text-page-title font-semibold text-foreground">
              {title}
            </h1>
            {intro && (
              <p className="m-0 mt-1 text-sm text-muted-foreground">{intro}</p>
            )}
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-field">
              {actions}
            </div>
          )}
        </div>
      </header>

      {children}
    </div>
  );
}
