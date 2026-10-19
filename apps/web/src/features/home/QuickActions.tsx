import { Button } from "@ketocare/ui";
import { Calculator, Droplets, Scale, UtensilsCrossed, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";

/**
 * Быстрая запись замера с главной (раздел 8.3 ТЗ).
 *
 * Ведут не «в раздел», а к действию: вид дневника передаётся в адресе, и
 * вкладку не приходится искать руками. Замер — то, что родитель делает
 * ежедневно и в спешке.
 *
 * Приступ — первым и намеренно: это самое срочное, что записывает семья, и
 * записывают его с телефона в тот момент, когда ребёнку плохо. До этого путь к
 * нему был длиннее всех остальных — раздел, потом вкладка. Одно-два касания за
 * ним сохраняются (правило П12 канона).
 *
 * **«Меню на день» отсюда убрано.** Это переход в раздел, а не запись, и он
 * дублировал сразу два пути к тому же месту: пункт бокового меню и кнопку
 * «Составить меню» в блоке ближайшего приёма пищи. Четыре одинаковые синие
 * кнопки подряд не отвечали на вопрос «с чего начать» — они его задавали.
 */
interface ActionItem {
  key: string;
  icon: LucideIcon;
  section?: string;
  kind?: string;
  iconTone: string;
}

const ACTIONS: readonly ActionItem[] = [
  {
    key: "seizure",
    icon: Zap,
    kind: "seizures",
    iconTone: "bg-destructive/12 text-destructive",
  },
  {
    key: "ketones",
    icon: Droplets,
    kind: "ketones",
    iconTone: "bg-primary/12 text-primary",
  },
  {
    key: "weight",
    icon: Scale,
    kind: "weight",
    iconTone: "bg-accent text-accent-foreground",
  },
  {
    key: "meal",
    icon: UtensilsCrossed,
    kind: "meals",
    iconTone: "bg-chart-carbs/12 text-chart-carbs",
  },
  {
    key: "calculator",
    icon: Calculator,
    section: "calculator",
    iconTone: "bg-primary/12 text-primary",
  },
] as const;

export function QuickActions() {
  const { t } = useTranslation("home");

  return (
    <nav
      aria-label={t("quickActions.title")}
      className="flex flex-col gap-field"
    >
      {/* Видимый заголовок, а не только метка для скринридера: родителю без
          опыта работы с интерфейсами ряд кнопок без подписи не говорит, что
          это одно и то же дело — запись замера. */}
      <p className="m-0 text-sm font-medium text-muted-foreground">
        {t("quickActions.title")}
      </p>

      {/* Вторичные, а не первичные. Первичное действие на экране одно (правило
          П31), и это «что делать сегодня» — составить меню или открыть план
          дня. Замеры записывают часто, но это не то, с чего начинают: пока все
          кнопки были одного веса, экран предлагал пять равных начал. Касание
          при этом осталось одним, а цель — 44 px. */}
      <ul className="m-0 grid list-none gap-field p-0 sm:flex sm:flex-row sm:flex-wrap">
        {ACTIONS.map(({ key, icon: Icon, section, kind, iconTone }) => (
          <li key={key}>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="min-h-touch w-full justify-start gap-2.5 bg-card px-3.5 shadow-kc-sm sm:w-auto"
            >
              <SectionLink
                section={section ?? "diary"}
                diaryKind={kind}
                item={kind ? "new" : undefined}
              >
                <span
                  aria-hidden="true"
                  className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md ${iconTone}`}
                >
                  <Icon className="size-3.5" />
                </span>
                {t(`quickActions.${key}`)}
              </SectionLink>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
