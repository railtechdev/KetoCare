import { useTranslation } from "react-i18next";

import { Button } from "@ketocare/ui";
import { Calculator, CookingPot } from "lucide-react";

import { PageLayout } from "../../components/PageLayout";
import { SectionLink } from "../../components/SectionLink";
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
        <PageLayout title={t("title")} width="wide" actions={actions}>
          {/* Калькулятор и рецепты у семьи — части сборки меню, а не пункты
              бокового меню (этап 6 AUDIT_ROLES_PATHS_2026-11). */}
          <nav
            aria-label={t("tools.label")}
            className="flex flex-wrap gap-field"
          >
            <Button asChild variant="outline" className="min-h-touch">
              <SectionLink section="calculator">
                <Calculator aria-hidden="true" />
                {t("tools.calculator")}
              </SectionLink>
            </Button>
            <Button asChild variant="outline" className="min-h-touch">
              <SectionLink section="recipes">
                <CookingPot aria-hidden="true" />
                {t("tools.recipes")}
              </SectionLink>
            </Button>
          </nav>
          {content}
        </PageLayout>
      )}
    </DayComposer>
  );
}
