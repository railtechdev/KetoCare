import { Button } from "@ketocare/ui";
import { CalendarDays, Droplets, Scale } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";

/**
 * Три быстрые кнопки (раздел 8.3 ТЗ).
 *
 * Ведут не «в раздел», а к действию: записать кетоны, записать вес, открыть
 * меню на день. Замер — то, что родитель делает ежедневно и в спешке, поэтому
 * вид дневника передаётся в адресе, и вкладку не приходится искать руками.
 */
const ACTIONS = [
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
