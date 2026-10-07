import { useTranslation } from "react-i18next";

/** id основной области кабинета: на неё ведёт ссылка «Перейти к содержимому». */
export const MAIN_CONTENT_ID = "main-content";

/**
 * Ссылка в обход навигации (правило П21 канона, WCAG 2.4.1 «Bypass Blocks»).
 *
 * Стоит первой в разметке каркаса — раньше шапки и боковой панели: без неё
 * человек с клавиатуры проходит Tab'ом всю навигацию (до десятка пунктов) на
 * каждом экране, прежде чем доберётся до формы. Видна только в фокусе.
 *
 * Фокус переносится явно: переход по якорю прокручивает страницу, но в части
 * браузеров фокус остаётся на ссылке, и следующий Tab снова уводит в меню.
 * Цель — `main` с `tabIndex={-1}`, иначе ей фокус не принять.
 */
export function SkipLink() {
  const { t } = useTranslation();

  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      onClick={(event) => {
        const target = document.getElementById(MAIN_CONTENT_ID);
        if (target === null) return;
        event.preventDefault();
        target.focus();
        target.scrollIntoView?.();
      }}
      className="sr-only z-50 rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      {t("nav.skipToContent")}
    </a>
  );
}
