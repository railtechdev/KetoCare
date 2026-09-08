import { Button } from "@ketocare/ui";
import { Droplets, Scale, Zap } from "lucide-react";
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
const ACTIONS = [
  { key: "seizure", icon: Zap, kind: "seizures" },
  { key: "ketones", icon: Droplets, kind: "ketones" },
  { key: "weight", icon: Scale, kind: "weight" },
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
      <p className="m-0 text-sm text-muted-foreground">
        {t("quickActions.title")}
      </p>

      {/* Вторичные, а не первичные. Первичное действие на экране одно (правило
          П31), и это «что делать сегодня» — составить меню или открыть план
          дня. Замеры записывают часто, но это не то, с чего начинают: пока все
          кнопки были одного веса, экран предлагал пять равных начал. Касание
          при этом осталось одним, а цель — 44 px. */}
      <ul className="m-0 flex list-none flex-col gap-field p-0 sm:flex-row sm:flex-wrap">
        {ACTIONS.map(({ key, icon: Icon, kind }) => (
          <li key={key}>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="min-h-touch w-full sm:w-auto"
            >
              <SectionLink section="diary" diaryKind={kind}>
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
