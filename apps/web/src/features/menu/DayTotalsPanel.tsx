import {
  EmptyState,
  MacroBar,
  RatioBadge,
  Section,
  WarningBanner,
  dayVerdict,
  formatKcal,
  toleranceGapKey,
  type DayTolerance,
  type ToleranceGap,
} from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { DayTargetBars } from "./DayTargetBars";
import type { DayTargets, DayTotals } from "./useMenu";

interface Props {
  totals: DayTotals | null;
  engineVersion: string | null;
  /** Вердикт о допусках приходит от сервера; на клиенте он не вычисляется */
  tolerance: DayTolerance | null;
  /**
   * Почему вердикта нет — тоже от сервера.
   *
   * `null` означает «причина неизвестна»: так бывает у прошедших дат, для
   * которых сервер вердикта не считает вовсе. Тогда остаётся общий текст.
   */
  toleranceGap: ToleranceGap | null;
  /** Нормы назначения; `null` — сравнивать не с чем, остаток не показывается */
  targets: DayTargets | null;
}

/** Числа в русской записи: «12,5 г», а не «12.5 г» (правило П22 канона). */

/** Итоги дня против назначения (раздел 8.3 ТЗ, строка «Меню»). */
export function DayTotalsPanel({
  totals,
  engineVersion,
  tolerance,
  toleranceGap,
  targets,
}: Props) {
  const { t } = useTranslation("menu");

  // Пустой день до этого блока не доходит — о нём говорит блок приёмов пищи
  // (правило П27). Сюда `null` попадает только если сервер не вернул итогов при
  // непустом меню: это одна строка, а не карточка на 134 px.
  if (totals === null) {
    return (
      <Section title={t("totals.title")}>
        <EmptyState size="inline" title={t("totals.none")} />
      </Section>
    );
  }

  const verdict = dayVerdict(tolerance, toleranceGap);

  return (
    <Section title={t("totals.title")}>
      <div className="flex flex-wrap items-center gap-section">
        <RatioBadge
          ratio={totals.ratio}
          withinTolerance={tolerance?.ratio_within_tolerance ?? undefined}
        />
        <span className="tabular-nums">
          {targets === null
            ? t("totals.kcal", { value: formatKcal(totals.kcal) })
            : t("totals.kcalOfTarget", {
                value: formatKcal(totals.kcal),
                target: formatKcal(targets.kcalPerDay),
              })}
        </span>
      </div>

      <MacroBar
        fatG={totals.fat}
        proteinG={totals.protein}
        carbsG={totals.carbs}
      />

      {/* Цели — полосой, а не только числом (П40): «осталось 910,5 ккал»
          родитель читал и складывал в уме. */}
      {targets !== null && (
        <DayTargetBars
          kcal={totals.kcal}
          carbs={totals.carbs}
          kcalTarget={targets.kcalPerDay}
          carbsLimit={targets.carbsLimitG}
        />
      )}

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

      {/* Причина называется словами сервера. Общий текст остаётся только там,
          где причины нет: для прошедших дат вердикт не считается вовсе. */}
      {verdict.unavailable && (
        <p className="m-0 text-sm text-muted-foreground">
          {t(`totals.${toleranceGapKey(verdict.unavailableReason)}`)}
        </p>
      )}

      {/* Версия ядра показывается рядом с итогами: расчёт, сделанный разными
            версиями, может отличаться, и это должно быть видно. */}
      {engineVersion !== null && (
        <p className="m-0 text-xs text-muted-foreground">
          {t("totals.engineVersion", { version: engineVersion })}
        </p>
      )}
    </Section>
  );
}
