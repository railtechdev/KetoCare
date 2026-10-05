import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { DayComposer } from "./DayComposer";

/**
 * Меню дня для родителя (раздел 8.3 ТЗ, строка «Меню»).
 *
 * Сам день собирает `DayComposer` — тот же, что в карте пациента у
 * специалиста (ADR-0047). Здесь — только шапка экрана семьи.
 */
export function MenuPage({ patientId }: { patientId: string }) {
  const { t } = useTranslation("menu");

  return (
    <DayComposer patientId={patientId} canMarkEaten>
      {({ actions, content }) => (
        // План дня и итоги стоят рядом — это просит ширины (правило П34 канона).
        <PageLayout
          title={t("title")}
          intro={t("intro")}
          width="wide"
          actions={actions}
        >
          {content}
        </PageLayout>
      )}
    </DayComposer>
  );
}
