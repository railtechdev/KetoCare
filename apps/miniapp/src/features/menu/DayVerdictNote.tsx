import {
  WarningBanner,
  dayVerdict,
  formatKcal,
  kcalToTarget,
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
  open = false,
  kcal,
  targetKcal,
  kcalHint = true,
  composedBy = null,
}: {
  tolerance: DayTolerance | null | undefined;
  gap: ToleranceGap | null | undefined;
  otherDay?: boolean;
  /**
   * День сегодняшний или будущий — его ещё собирают (`dayIsOpen` кита). Пока
   * норма не набрана, о соотношении — спокойная строка (Р2 аудита Mini App).
   */
  open?: boolean;
  kcal: number;
  targetKcal: number | null;
  /**
   * Говорить ли «добавьте ещё N ккал». Нет там, где ту же подсказку уже
   * печатает полоса калорийности (`DayTotals`): одна фраза дважды подряд —
   * шум, а не забота.
   */
  kcalHint?: boolean;
  /**
   * Имя специалиста, составившего день, — или `null`, если день собирала
   * семья. День специалиста семья не перестраивает: совет «измените состав»
   * читался как «вы сделали неправильно, исправляйте сами» (аудит интерфейса
   * 18.11.2026, Р3).
   */
  composedBy?: string | null;
}) {
  const { t } = useTranslation();

  if (otherDay) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        {t("verdict.otherDay")}
      </p>
    );
  }

  const verdict = dayVerdict(tolerance, gap ?? null, {
    open,
    kcal,
    targetKcal,
  });

  return (
    <div className="flex flex-col gap-field">
      {verdict.unavailable ? (
        <p className="m-0 text-sm text-muted-foreground">
          {t(`verdict.${toleranceGapKey(verdict.unavailableReason)}`)}
        </p>
      ) : verdict.ratioPending ? (
        // День ещё собирается (Р2): тревога «измените состав» на первом блюде
        // говорила семье, что она ошиблась, когда она только начала. Так же и
        // у дня специалиста — его семья тем более не перестраивает.
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("verdict.ratioPending")}
        </p>
      ) : verdict.ratioOffTolerance ? (
        composedBy !== null ? (
          <WarningBanner level="info" title={t("verdict.bySpecialist.ratio")}>
            {t("verdict.bySpecialist.body", { name: composedBy })}
          </WarningBanner>
        ) : (
          <WarningBanner
            level="warning"
            title={t("verdict.offTolerance.title")}
          >
            {t("verdict.offTolerance.body")}
          </WarningBanner>
        )
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

      {/* Лимит углеводов — граница: превышение верно в любой момент дня
          (аудит расчётов 13.11.2026). */}
      {verdict.carbsOverLimit &&
        (composedBy !== null ? (
          <WarningBanner level="info" title={t("verdict.bySpecialist.carbs")}>
            {t("verdict.bySpecialist.body", { name: composedBy })}
          </WarningBanner>
        ) : (
          <WarningBanner level="warning" title={t("verdict.carbsOver.title")}>
            {t("verdict.carbsOver.body")}
          </WarningBanner>
        ))}

      {verdict.kcalBelowTarget && kcalHint && (
        <p className="m-0 text-sm text-muted-foreground">
          {targetKcal === null
            ? t("verdict.kcalBelowTargetPlain")
            : t("verdict.kcalBelowTarget", {
                value: formatKcal(kcal),
                target: formatKcal(targetKcal),
                left: formatKcal(kcalToTarget(kcal, targetKcal)),
              })}
        </p>
      )}
    </div>
  );
}
