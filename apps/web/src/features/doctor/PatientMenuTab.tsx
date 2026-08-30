import { AsyncSection, Badge, EmptyState, Section } from "@ketocare/ui";
import { CalendarOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { DayNavigator } from "../menu/DayNavigator";
import { DayTotalsPanel } from "../menu/DayTotalsPanel";
import { todayIso } from "../menu/dates";
import { itemDishKey, useMenuItemTitles } from "../menu/useDishCatalog";
import {
  MEAL_SLOTS,
  useDayTargets,
  useDayTolerance,
  useMenuQuery,
} from "../menu/useMenu";
import { LinesSkeleton } from "./skeletons";

/**
 * План питания пациента глазами специалиста — только на чтение.
 *
 * Врач назначает кетосоотношение, но не видел, из чего оно набирается: в карте
 * был дневник «Питание» (что семья записала съеденным) и итоги дня числами, а
 * самого плана — какие блюда и по сколько граммов — не было нигде.
 *
 * Именно на чтение: меню составляет и правит семья, она же отмечает съеденное.
 * Сервер правку специалисту не запрещает, но менять план семьи за её спиной —
 * не работа врача; расхождение между тем, что семья видит на кухне, и тем, что
 * кто-то поправил из кабинета, — клинический риск.
 */
export function PatientMenuTab({ patientId }: { patientId: string }) {
  const { t } = useTranslation("doctor");
  const [date, setDate] = useState(todayIso);

  const menu = useMenuQuery(patientId, date);
  const tolerance = useDayTolerance(patientId, date);
  const targets = useDayTargets(patientId, date);

  const items = menu.data?.items ?? [];
  const titles = useMenuItemTitles(patientId, items);

  return (
    <div className="flex flex-col gap-block">
      <Section title={t("menu.dayTitle")} density="compact">
        <DayNavigator date={date} onChange={setDate} />
      </Section>

      <AsyncSection
        loading={menu.isPending}
        skeleton={<LinesSkeleton label={t("menu.loading")} lines={5} />}
        error={
          menu.isError
            ? {
                title: t("menu.loadError"),
                description:
                  errorMessageOf(menu.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void menu.refetch()}
        // Меню на день не составлено — сервер отвечает 404, запрос отдаёт
        // `null`. Это обычное пустое состояние, а не сбой.
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={CalendarOff}
            title={t("menu.empty")}
            description={t("menu.emptyDescription")}
          />
        }
      >
        {MEAL_SLOTS.map((slot) => {
          const slotItems = items.filter((item) => item.meal_slot === slot);
          if (slotItems.length === 0) return null;

          return (
            <Section
              key={slot}
              title={t(`menu.slots.${slot}`)}
              level={3}
              density="compact"
            >
              <ul className="m-0 flex list-none flex-col gap-field p-0">
                {slotItems.map((item) => {
                  const key = itemDishKey(item);
                  return (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center gap-field rounded-lg border border-border px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 break-words">
                        {(key === null ? undefined : titles[key]) ??
                          t("menu.unknownDish")}
                      </span>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {t("menu.portion", { value: item.portion_factor })}
                      </span>
                      {/* Отметка семьи — то, что отличает план от выполнения:
                          без неё врач видит намерение и принимает его за факт. */}
                      <Badge variant={item.eaten ? "secondary" : "outline"}>
                        {item.eaten ? t("menu.eaten") : t("menu.notEaten")}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </Section>
          );
        })}

        <DayTotalsPanel
          totals={menu.data?.totals ?? null}
          engineVersion={menu.data?.engine_version ?? null}
          tolerance={tolerance}
          targets={targets}
        />
      </AsyncSection>
    </div>
  );
}
