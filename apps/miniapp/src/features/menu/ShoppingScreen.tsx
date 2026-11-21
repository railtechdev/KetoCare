import {
  AsyncSection,
  Button,
  Checkbox,
  cn,
  daysWithMenu,
  formatLongDate,
  formatMass,
  parseDateInput,
  shoppingList,
} from "@ketocare/ui";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useTelegramBack } from "../../lib/useTelegram";
import { LAST_PLAN_OFFSET, PLAN_DAYS, WEEK_START_OFFSET } from "./planDays";
import { dayAt, useMenuWeek } from "./useMenu";

/**
 * «Что купить» — продукты меню с сегодня по последний день полосы, сложенные
 * по продукту (Р3 аудита Mini App 21.11.2026).
 *
 * Сложение — `shoppingList` кита, то же, что у листа «Что взвесить за неделю»
 * в кабинете: семья с телефоном и семья с листом покупают одно и то же.
 * Граммы — сколько взвесить по меню, без запаса на очистку; приправы — списком
 * без граммов (ADR-0054). Отметки «куплено» живут на экране: это список на
 * один поход в магазин, а не запись для врача.
 *
 * Неделя запрашивается та же, что у полосы дней (со вчерашнего дня), и
 * вчерашний день отбрасывается: к нему не покупают.
 */
export function ShoppingScreen({
  patientId,
  onBack,
}: {
  patientId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  useTelegramBack(onBack);
  const week = useMenuWeek(patientId, dayAt(WEEK_START_OFFSET));
  const [bought, setBought] = useState<ReadonlySet<string>>(new Set());

  const from = dayAt(PLAN_DAYS[0]);
  const to = dayAt(LAST_PLAN_OFFSET);
  const days = (week.data?.days ?? []).filter(
    (day) => day.date >= from && day.date <= to,
  );
  const { lines, seasonings } = shoppingList({ days });
  const composed = daysWithMenu(days).length;
  const fromDate = parseDateInput(from);
  const toDate = parseDateInput(to);

  const toggle = (productId: string) => {
    setBought((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  return (
    <main className="flex flex-col gap-section p-section">
      <Button
        variant="ghost"
        className="min-h-touch self-start"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t("shopping.back")}
      </Button>
      <h1 className="text-page-title">{t("shopping.title")}</h1>
      {fromDate !== null && toDate !== null && (
        <p className="m-0 text-muted-foreground">
          {t("shopping.range", {
            from: formatLongDate(fromDate),
            to: formatLongDate(toDate),
          })}
        </p>
      )}

      <AsyncSection
        loading={week.isPending}
        skeleton={null}
        error={
          week.isError
            ? {
                title: t("shopping.loadError"),
                description:
                  errorMessageOf(week.error) ?? t("home.loadErrorHint"),
              }
            : null
        }
        waiting={
          week.fetchStatus === "paused" ? t("errors.waitingForNetwork") : null
        }
        retryLabel={t("actions.retry")}
        onRetry={() => void week.refetch()}
        isEmpty={week.isSuccess && composed === 0}
        empty={
          <p className="m-0 text-muted-foreground">{t("shopping.none")}</p>
        }
      >
        {week.isSuccess && composed > 0 && (
          <div className="flex flex-col gap-section">
            {/* Неделя собрана не вся: список говорит, сколько дней в нём. */}
            <p className="m-0 text-sm">
              {t("shopping.days", { count: composed, total: PLAN_DAYS.length })}
            </p>
            {lines.length > 0 && (
              <ul className="m-0 flex list-none flex-col p-0">
                {lines.map((line) => {
                  const done = bought.has(line.productId);
                  return (
                    <li
                      key={line.productId}
                      className="border-b border-border last:border-b-0"
                    >
                      <label className="flex min-h-touch cursor-pointer items-center gap-field py-1">
                        <Checkbox
                          checked={done}
                          onChange={() => toggle(line.productId)}
                        />
                        <span
                          className={cn(
                            "min-w-0 flex-1",
                            done && "text-muted-foreground line-through",
                          )}
                        >
                          {line.name}
                          <span className="block text-xs text-muted-foreground">
                            {t("shopping.inDays", { count: line.days })}
                          </span>
                        </span>
                        <span className="font-semibold whitespace-nowrap tabular-nums">
                          {t("shopping.grams", {
                            value: formatMass(line.grams),
                          })}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {seasonings.length > 0 && (
              <p className="m-0">
                <span className="font-semibold">
                  {t("shopping.seasonings")}
                </span>{" "}
                {seasonings.join(", ")}
              </p>
            )}
            <p className="m-0 text-sm text-muted-foreground">
              {t("shopping.note")}
            </p>
          </div>
        )}
      </AsyncSection>
    </main>
  );
}
