import { Button, WarningBanner } from "@ketocare/ui";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * Раздел, который не открылся, говорит об этом словами (аудит 26.11.2026, 1.12).
 *
 * «Дневник», «Блюда» и «Помощник» грузятся по требованию. Без этой границы
 * файл раздела, не дошедший из-за секундного обрыва связи, снимал всё
 * приложение: пустой экран без единого слова, и набранное на других вкладках
 * пропадало. Теперь ломается только этот раздел, остальные вкладки работают.
 *
 * «Повторить» перезагружает страницу: неудавшуюся загрузку React запоминает, и
 * повторить её без перезагрузки нельзя. Подпись запуска Telegram лежит в
 * адресе и перезагрузку переживает.
 */
export class SectionErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("section_failed", error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? <SectionFailed /> : this.props.children;
  }
}

function SectionFailed() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-field p-section">
      <WarningBanner level="danger" title={t("errors.sectionFailed")}>
        {t("errors.sectionFailedHint")}
      </WarningBanner>
      <Button
        type="button"
        className="min-h-touch w-full"
        onClick={() => window.location.reload()}
      >
        {t("actions.retry")}
      </Button>
    </div>
  );
}
