import {
  AsyncSection,
  Badge,
  Button,
  EmptyState,
  Skeleton,
} from "@ketocare/ui";
import { CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";
import { errorMessageOf } from "../../lib/api";
import { MEAL_SLOTS, useMenuQuery } from "../menu/useMenu";
import { itemDishKey, useMenuItemTitles } from "../menu/useDishCatalog";
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
 *
 * Упавший запрос показывается ошибкой с повтором, а не пустым меню: «меню на
 * сегодня ещё не составлено» вместо сорвавшегося запроса — неправда, и родитель
 * начал бы составлять день заново. Отсутствие меню (404) запрос отдаёт как
 * `null`, и это остаётся обычным пустым состоянием.
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

  // Название берётся тем же ключом, что и в меню: словарь заполнен по
  // `recipe:<id>` / `custom:<id>`, а не по идентификатору позиции.
  const dishKeyOfNext = next ? itemDishKey(next) : null;
  const dishTitle = dishKeyOfNext === null ? null : titles[dishKeyOfNext];

  // Ссылка «Всё меню» ведёт к тому, чего ещё нет, когда меню на день не
  // составлено, — там достаточно кнопки пустого состояния.
  const showAction = menu.isPending || items.length > 0;
  const action = (
    <Button asChild variant="ghost" size="sm">
      <SectionLink section="menu">{t("nextMeal.toMenu")}</SectionLink>
    </Button>
  );

  return (
    <Panel title={t("nextMeal.title")} action={showAction ? action : undefined}>
      <AsyncSection
        loading={menu.isPending}
        skeleton={
          <div
            className="flex flex-col gap-field"
            role="status"
            aria-busy="true"
          >
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        }
        error={
          menu.isError
            ? {
                title: t("nextMeal.errorTitle"),
                description:
                  errorMessageOf(menu.error) ?? t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void menu.refetch()}
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={CalendarDays}
            title={t("nextMeal.noMenu")}
            description={t("nextMeal.noMenuHint")}
            action={
              <Button asChild className="min-h-touch">
                <SectionLink section="menu">
                  {t("nextMeal.planMenu")}
                </SectionLink>
              </Button>
            }
          />
        }
      >
        {next === undefined ? (
          // Не тост: это состояние дня, а не подтверждение только что сделанного
          // действия — оно должно оставаться на экране (правило П16 канона).
          <p role="status" className="m-0 text-success">
            {t("nextMeal.allEaten")}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-block">
            <Badge variant="secondary">
              {t(`nextMeal.slots.${next.meal_slot}`)}
            </Badge>
            <span className="min-w-0 text-card-title font-semibold break-words">
              {/* Ключ словаря — `recipe:<id>` / `custom:<id>`, а не идентификатор
                  позиции меню: `titles[next.id]` не совпадал никогда, и главный
                  блок главной вместо названия блюда всегда показывал «Блюдо».
                  В меню тот же словарь читается правильно — через `itemDishKey`. */}
              {dishTitle ?? t("nextMeal.unknownDish")}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {t("nextMeal.portion", { value: next.portion_factor })}
            </span>
          </div>
        )}
      </AsyncSection>
    </Panel>
  );
}
