import { MacroBar, RatioBadge, Section, WarningBanner } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import { dayVerdict, type DayTolerance } from "../patients/dayVerdict";
import type { DayTargets, DayTotals } from "./useMenu";

interface Props {
  totals: DayTotals | null;
  engineVersion: string | null;
  /** Вердикт о допусках приходит от сервера; на клиенте он не вычисляется */
  tolerance: DayTolerance | null;
  /** Нормы назначения; `null` — сравнивать не с чем, остаток не показывается */
  targets: DayTargets | null;
}

/** Числа в русской записи: «12,5 г», а не «12.5 г» (правило П22 канона). */
const AMOUNT = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/** Итоги дня против назначения (раздел 8.3 ТЗ, строка «Меню»). */
export function DayTotalsPanel({
  totals,
  engineVersion,
  tolerance,
  targets,
}: Props) {
  const { t } = useTranslation("menu");

  // Пустой день до этого блока не доходит — о нём говорит блок приёмов пищи
  // (правило П27). Сюда `null` попадает только если сервер не вернул итогов при
  // непустом меню: это одна строка, а не карточка на 134 px.
  if (totals === null) {
    return (
      <Section title={t("totals.title")}>
        <p className="m-0 text-sm text-muted-foreground">{t("totals.none")}</p>
      </Section>
    );
  }

  const verdict = dayVerdict(tolerance);

  // «Осталось до цели» вместо арифметики в уме (правило П18 канона). Знак
  // разницы решает только формулировку: превышение — не вердикт о соответствии
  // назначению, его выносит сервер (`patients/dayVerdict`).
  const left =
    targets === null
      ? null
      : {
          kcal: targets.kcalPerDay - totals.kcal,
          carbs: targets.carbsLimitG - totals.carbs,
        };

  return (
    <Section title={t("totals.title")}>
      <div className="flex flex-wrap items-center gap-block">
        <RatioBadge
          ratio={totals.ratio}
          withinTolerance={tolerance?.ratio_within_tolerance}
        />
        <span className="tabular-nums">
          {targets === null
            ? t("totals.kcal", { value: totals.kcal.toFixed(0) })
            : t("totals.kcalOfTarget", {
                value: totals.kcal.toFixed(0),
                target: targets.kcalPerDay.toFixed(0),
              })}
        </span>
      </div>

      <MacroBar
        fatG={totals.fat}
        proteinG={totals.protein}
        carbsG={totals.carbs}
      />

      {targets !== null && left !== null && (
        <dl className="m-0 grid gap-block sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-sm text-muted-foreground">
              {t("totals.kcalLabel")}
            </dt>
            <dd className="m-0 tabular-nums">
              {left.kcal >= 0
                ? t("totals.kcalLeft", { value: AMOUNT.format(left.kcal) })
                : t("totals.kcalOver", { value: AMOUNT.format(-left.kcal) })}
            </dd>
          </div>

          <div className="min-w-0">
            <dt className="text-sm text-muted-foreground">
              {t("totals.carbsLabel")}
            </dt>
            <dd className="m-0 tabular-nums">
              {t("totals.carbsOfLimit", {
                value: AMOUNT.format(totals.carbs),
                limit: AMOUNT.format(targets.carbsLimitG),
              })}
            </dd>
            <dd className="m-0 text-sm text-muted-foreground tabular-nums">
              {left.carbs >= 0
                ? t("totals.carbsLeft", { value: AMOUNT.format(left.carbs) })
                : t("totals.carbsOver", {
                    value: AMOUNT.format(-left.carbs),
                  })}
            </dd>
          </div>
        </dl>
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
    </Section>
  );
}
