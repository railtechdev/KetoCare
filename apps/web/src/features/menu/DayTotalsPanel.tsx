import { MacroBar, RatioBadge, WarningBanner } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { dayVerdict, type DayTolerance } from "../patients/dayVerdict";
import type { DayTotals } from "./useMenu";

interface Props {
  totals: DayTotals | null;
  engineVersion: string | null;
  /** Вердикт о допусках приходит от сервера; на клиенте он не вычисляется */
  tolerance: DayTolerance | null;
}

/** Итоги дня против назначения (раздел 8.3 ТЗ, строка «Меню»). */
export function DayTotalsPanel({ totals, engineVersion, tolerance }: Props) {
  const { t } = useTranslation("menu");

  if (totals === null) {
    return (
      <section
        aria-label={t("totals.title")}
        className="rounded-xl bg-card p-4 shadow-kc-sm"
      >
        <h2 className="m-0 text-lg font-semibold">{t("totals.title")}</h2>
        <p className="mt-2 mb-0 text-muted-foreground">{t("totals.none")}</p>
      </section>
    );
  }

  const verdict = dayVerdict(tolerance);

  return (
    <section
      aria-label={t("totals.title")}
      className="flex flex-col gap-4 rounded-xl bg-card p-4 shadow-kc-sm"
    >
      <h2 className="m-0 text-lg font-semibold">{t("totals.title")}</h2>

      <div className="flex flex-wrap items-center gap-4">
        <RatioBadge
          ratio={totals.ratio}
          withinTolerance={tolerance?.ratio_within_tolerance}
        />
        <span className="tabular-nums">
          {t("totals.kcal", { value: totals.kcal.toFixed(0) })}
        </span>
      </div>

      <MacroBar
        fatG={totals.fat}
        proteinG={totals.protein}
        carbsG={totals.carbs}
      />

      {verdict.ratioOffTolerance && (
        <WarningBanner level="warning" title={t("offTolerance.title")}>
          {t("offTolerance.body")}
        </WarningBanner>
      )}

      {verdict.kcalBelowTarget && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("offTolerance.kcalBelowTarget")}
        </p>
      )}

      {verdict.unavailable && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("totals.verdictUnavailable")}
        </p>
      )}

      {/* Версия ядра показывается рядом с итогами: расчёт, сделанный разными
          версиями, может отличаться, и это должно быть видно. */}
      {engineVersion !== null && (
        <p className="m-0 text-xs text-muted-foreground">
          {t("totals.engineVersion", { version: engineVersion })}
        </p>
      )}
    </section>
  );
}
