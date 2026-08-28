import { Badge, Button } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";
import { MEAL_SLOTS, useMenuQuery } from "../menu/useMenu";
import { useMenuItemTitles } from "../menu/useDishCatalog";
import { todayIso } from "../menu/dates";
import { Panel } from "./Panel";

/**
 * Ближайший приём пищи — то, ради чего родитель чаще всего открывает кабинет:
 * что и сколько дать прямо сейчас.
 *
 * «Ближайший» определяется как первый несъеденный приём в порядке дня, а не по
 * часам: времени приёмов система не хранит, а порядок завтрак → обед → ужин →
 * перекус задан разделом 4.2 ТЗ. Когда всё отмечено съеденным, показывается,
 * что день пройден, — это ответ, а не пустота.
 */
export function NextMealCard({ patientId }: { patientId: string }) {
  const { t } = useTranslation("home");
  const date = todayIso();
  const menu = useMenuQuery(patientId, date);

  const items = menu.data?.items ?? [];
  const titles = useMenuItemTitles(patientId, items);

  const next = MEAL_SLOTS.flatMap((slot) =>
    items.filter((item) => item.meal_slot === slot),
  ).find((item) => !item.eaten);

  const action = (
    <Button asChild variant="ghost" size="sm">
      <SectionLink section="menu">{t("nextMeal.toMenu")}</SectionLink>
    </Button>
  );

  if (menu.isPending) {
    return (
      <Panel title={t("nextMeal.title")} action={action}>
        <p role="status" className="m-0 text-muted-foreground">
          {t("loading")}
        </p>
      </Panel>
    );
  }

  if (items.length === 0) {
    return (
      <Panel title={t("nextMeal.title")} action={action}>
        <p className="m-0 text-muted-foreground">{t("nextMeal.noMenu")}</p>
      </Panel>
    );
  }

  if (next === undefined) {
    return (
      <Panel title={t("nextMeal.title")} action={action}>
        <p role="status" className="m-0 text-success">
          {t("nextMeal.allEaten")}
        </p>
      </Panel>
    );
  }

  const title = titles[next.id] ?? t("nextMeal.unknownDish");

  return (
    <Panel title={t("nextMeal.title")} action={action}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary">
          {t(`nextMeal.slots.${next.meal_slot}`)}
        </Badge>
        <span className="text-lg font-semibold">{title}</span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t("nextMeal.portion", { value: next.portion_factor })}
        </span>
      </div>
    </Panel>
  );
}
