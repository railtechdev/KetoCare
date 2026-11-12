import {
  AsyncSection,
  Button,
  EmptyState,
  RatioBadge,
  formatKcal,
} from "@ketocare/ui";
import { CookingPot } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { AddToPlan } from "../menu/AddToPlan";
import { useCustomDishes } from "../menu/useDishOptions";

/**
 * Блюда ребёнка — то, что семья собрала в расчёте или завёл специалист.
 *
 * Прежде их было видно только в поиске при сборке меню: открыть список своих
 * блюд и поставить одно в меню было негде. Теперь у каждого «В меню» — тот же
 * путь записи, что у сборки дня (`AddToPlan`).
 *
 * Пометки «не как в назначении» здесь нет: блюдо ребёнка собирают под его
 * назначение, а сверку блюд с назначением сервер отдаёт только специалисту.
 * Считать её в приложении — второй источник клинических чисел.
 */
export function ChildDishes({
  patientId,
  onOpenCalculator,
}: {
  patientId: string;
  onOpenCalculator: () => void;
}) {
  const { t } = useTranslation();
  const dishes = useCustomDishes(patientId);
  const [planning, setPlanning] = useState<string | null>(null);

  return (
    <section
      aria-label={t("dishes.sections.dishes")}
      className="flex flex-col gap-section"
    >
      <AsyncSection
        loading={dishes.isPending}
        skeleton={null}
        error={
          dishes.isError
            ? {
                title: t("dishes.loadError"),
                description:
                  errorMessageOf(dishes.error) ?? t("home.loadErrorHint"),
              }
            : null
        }
        waiting={
          dishes.fetchStatus === "paused" ? t("errors.waitingForNetwork") : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void dishes.refetch()}
        isEmpty={dishes.data?.length === 0}
        empty={
          // Пустое состояние — заголовок и кнопка (правило 3 словаря).
          <EmptyState
            icon={CookingPot}
            title={t("dishes.empty")}
            action={
              <Button
                type="button"
                className="min-h-touch w-full"
                onClick={onOpenCalculator}
              >
                {t("dishes.openCalculator")}
              </Button>
            }
          />
        }
      >
        <ul className="m-0 flex list-none flex-col gap-field p-0">
          {(dishes.data ?? []).map((dish) => (
            <li
              key={dish.id}
              className="flex flex-col gap-field rounded-xl border border-border px-3 py-2"
            >
              <div className="flex items-center gap-field">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="break-words">{dish.title}</span>
                  {dish.computed != null && (
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {t("menu.compose.kcal", {
                        value: formatKcal(dish.computed.kcal),
                      })}
                    </span>
                  )}
                </span>
                <RatioBadge ratio={dish.computed?.ratio ?? null} />
              </div>
              {planning === dish.id ? (
                <AddToPlan
                  patientId={patientId}
                  dish={{ kind: "custom", id: dish.id }}
                />
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-touch w-full"
                  onClick={() => setPlanning(dish.id)}
                >
                  {t("dishes.toMenu")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </AsyncSection>
    </section>
  );
}
