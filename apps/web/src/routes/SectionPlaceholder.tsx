import { useTranslation } from "react-i18next";

/**
 * Заглушка раздела. Экраны наполняются пп. 10-14 раздела 15 ТЗ; сейчас нужна
 * только чтобы роутинг и guard'ы можно было проверить целиком.
 */
export function SectionPlaceholder({ section }: { section: string }) {
  const { t } = useTranslation();

  return (
    <section>
      <h1 className="m-0 text-xl font-semibold">{t(`nav.${section}`)}</h1>
      <p className="mt-2 text-muted">{t("app.sectionComingSoon")}</p>
    </section>
  );
}
