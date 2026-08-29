import { Button, DiaryEntryCard, EmptyState } from "@ketocare/ui";
import { Droplets, Scale } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionLink } from "../../components/SectionLink";
import type { KetoneReading, WeightReading } from "./types";

interface Props {
  ketone: KetoneReading | null;
  weight: WeightReading | null;
}

/**
 * Последние кетоны и вес: значение, единица и момент замера.
 *
 * Числа выводятся как есть, без округления: сводка не должна показывать вес
 * или кетоны точнее либо грубее, чем их записала семья.
 */
export function LatestReadings({ ketone, weight }: Props) {
  const { t } = useTranslation("home");

  return (
    <section
      aria-labelledby="home-readings"
      className="flex flex-col gap-block"
    >
      <h2
        id="home-readings"
        className="m-0 text-section-title font-semibold text-foreground"
      >
        {t("readings.title")}
      </h2>

      <div className="grid gap-block sm:grid-cols-2">
        {ketone === null ? (
          <NoReading
            icon={Droplets}
            title={t("ketone.title")}
            description={t("ketone.empty")}
            actionLabel={t("quickActions.ketones")}
            diaryKind="ketones"
          />
        ) : (
          <DiaryEntryCard
            title={t("ketone.title")}
            occurredAt={new Date(ketone.occurred_at)}
          >
            <p className="m-0 text-page-title font-semibold tabular-nums">
              {t("ketone.value", { value: ketone.value })}
            </p>
            <p className="m-0 mt-1 text-sm text-muted-foreground">
              {t(`ketone.method.${ketone.method}`)}
            </p>
          </DiaryEntryCard>
        )}

        {weight === null ? (
          <NoReading
            icon={Scale}
            title={t("weight.title")}
            description={t("weight.empty")}
            actionLabel={t("quickActions.weight")}
            diaryKind="weight"
          />
        ) : (
          <DiaryEntryCard
            title={t("weight.title")}
            occurredAt={new Date(weight.occurred_at)}
          >
            <p className="m-0 text-page-title font-semibold tabular-nums">
              {t("weight.value", { value: weight.weight_kg })}
            </p>
          </DiaryEntryCard>
        )}
      </div>
    </section>
  );
}

/**
 * Замера ещё не было — это нормальное состояние, а не ошибка загрузки, и выход
 * из него один: записать замер. Поэтому кнопка ведёт сразу в нужный дневник.
 */
function NoReading({
  icon,
  title,
  description,
  actionLabel,
  diaryKind,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  diaryKind: string;
}) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      action={
        <Button asChild variant="outline" className="min-h-touch">
          <SectionLink section="diary" diaryKind={diaryKind}>
            {actionLabel}
          </SectionLink>
        </Button>
      }
    />
  );
}
