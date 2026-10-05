import {
  WarningBanner,
  dayVerdict,
  formatKcal,
  toleranceGapKey,
  type DayTolerance,
  type ToleranceGap,
} from "@ketocare/ui";
import { useTranslation } from "react-i18next";

/**
 * Что Mini App говорит о соответствии дня назначению.
 *
 * Решает не этот компонент, а `dayVerdict` кита — то же правило, по которому
 * говорит кабинет (ADR-0038, вопрос 9): кетосоотношение — предупреждение,
 * калорийность — набор, а отсутствие вердикта объясняется причиной сервера, у
 * каждой из трёх причин свой текст. Тексты те же, что в кабинете: семья из
 * Telegram и семья в кабинете — одна семья, и слышать о своём ребёнке разное в
 * разных каналах она не должна.
 *
 * Вердикт сервер считает только за сегодня (`/overview`); для других дней
 * (`otherDay`) экран так и говорит — а не «назначения нет» и не молчит, будто
 * всё в порядке.
 */
export function DayVerdictNote({
  tolerance,
  gap,
  otherDay = false,
  kcal,
  targetKcal,
}: {
  tolerance: DayTolerance | null | undefined;
  gap: ToleranceGap | null | undefined;
  otherDay?: boolean;
  kcal: number;
  targetKcal: number | null;
}) {
  const { t } = useTranslation();

  if (otherDay) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        {t("verdict.otherDay")}
      </p>
    );
  }

  const verdict = dayVerdict(tolerance, gap ?? null);

  return (
    <div className="flex flex-col gap-field">
      {verdict.unavailable ? (
        <p className="m-0 text-sm text-muted-foreground">
          {t(`verdict.${toleranceGapKey(verdict.unavailableReason)}`)}
        </p>
      ) : verdict.ratioOffTolerance ? (
        <WarningBanner level="warning" title={t("verdict.offTolerance.title")}>
          {t("verdict.offTolerance.body")}
        </WarningBanner>
      ) : verdict.ratioUnknown ? (
        // Соотношения у дня нет — ни тревоги, ни похвалы: сказать нечего.
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("verdict.ratioUnknown")}
        </p>
      ) : (
        // Состояние, которое перечитывают, а не подтверждение действия —
        // поэтому строка, а не тост (правило П16 канона).
        <p role="status" className="m-0 text-sm text-success">
          {t("verdict.withinTolerance")}
        </p>
      )}

      {verdict.kcalBelowTarget && (
        <p className="m-0 text-sm text-muted-foreground">
          {targetKcal === null
            ? t("verdict.kcalBelowTargetPlain")
            : t("verdict.kcalBelowTarget", {
                value: formatKcal(kcal),
                target: formatKcal(targetKcal),
              })}
        </p>
      )}
    </div>
  );
}
