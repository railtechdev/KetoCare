import { DiaryEntryCard } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

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
    <section aria-labelledby="home-readings">
      <h2 id="home-readings" className="m-0 text-base font-semibold">
        {t("readings.title")}
      </h2>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {ketone === null ? (
          <ReadingPlaceholder
            title={t("ketone.title")}
            message={t("ketone.empty")}
          />
        ) : (
          <DiaryEntryCard
            title={t("ketone.title")}
            occurredAt={new Date(ketone.occurred_at)}
          >
            <p className="m-0 text-2xl font-semibold tabular-nums">
              {t("ketone.value", { value: ketone.value })}
            </p>
            <p className="m-0 mt-1 text-sm text-muted-foreground">
              {t(`ketone.method.${ketone.method}`)}
            </p>
          </DiaryEntryCard>
        )}

        {weight === null ? (
          <ReadingPlaceholder
            title={t("weight.title")}
            message={t("weight.empty")}
          />
        ) : (
          <DiaryEntryCard
            title={t("weight.title")}
            occurredAt={new Date(weight.occurred_at)}
          >
            <p className="m-0 text-2xl font-semibold tabular-nums">
              {t("weight.value", { value: weight.weight_kg })}
            </p>
          </DiaryEntryCard>
        )}
      </div>
    </section>
  );
}

/** Замера ещё не было — это нормальное состояние, а не ошибка загрузки. */
function ReadingPlaceholder({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <article className="rounded-xl bg-card p-4 text-foreground shadow-kc">
      <h3 className="m-0 text-base font-semibold">{title}</h3>
      <p className="m-0 mt-2 text-muted-foreground">{message}</p>
    </article>
  );
}
