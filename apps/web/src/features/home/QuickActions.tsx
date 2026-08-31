import { Button } from "@ketocare/ui";
import { CalendarDays, Droplets, Scale, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";

/**
 * Быстрые кнопки главной (раздел 8.3 ТЗ).
 *
 * Ведут не «в раздел», а к действию: записать приступ, кетоны, вес, открыть
 * меню на день. Замер — то, что родитель делает ежедневно и в спешке, поэтому
 * вид дневника передаётся в адресе, и вкладку не приходится искать руками.
 *
 * Приступ — первым и намеренно: это самое срочное, что записывает семья, и
 * записывают его с телефона в тот момент, когда ребёнку плохо. До этого путь к
 * нему был длиннее всех остальных — раздел, потом вкладка.
 */
const ACTIONS = [
  { key: "seizure", icon: Zap, section: "diary", kind: "seizures" },
  { key: "ketones", icon: Droplets, section: "diary", kind: "ketones" },
  { key: "weight", icon: Scale, section: "diary", kind: "weight" },
  { key: "menu", icon: CalendarDays, section: "menu", kind: undefined },
] as const;

export function QuickActions() {
  const { t } = useTranslation("home");

  return (
    <nav aria-label={t("quickActions.title")}>
      <ul className="m-0 flex list-none flex-col gap-block p-0 sm:flex-row sm:flex-wrap">
        {ACTIONS.map(({ key, icon: Icon, section, kind }) => (
          <li key={key}>
            <Button asChild size="lg" className="min-h-touch w-full sm:w-auto">
              <SectionLink section={section} diaryKind={kind}>
                <Icon aria-hidden="true" />
                {t(`quickActions.${key}`)}
              </SectionLink>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
