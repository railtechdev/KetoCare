import { Toaster } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

/**
 * Область уведомлений кабинета. Подпись области sonner собирает из
 * `containerAriaLabel` и сочетания клавиш, и по умолчанию она английская —
 * скринридер зачитывал «Notifications alt+T» посреди русского интерфейса.
 * Сочетание клавиш sonner дописывает сам, поэтому подменяется только слово.
 */
export function AppToaster() {
  const { t } = useTranslation("common");

  return (
    <Toaster
      position="bottom-right"
      containerAriaLabel={t("app.notifications")}
    />
  );
}
