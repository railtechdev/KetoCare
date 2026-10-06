import { WarningBanner, formatKcal } from "@ketocare/ui";
import { useTranslation } from "react-i18next";

import type { PatientOverview } from "./types";

/**
 * «Вчера ребёнок недобрал N ккал» — ответ клиники от 09.09.2026 на вопрос 9:
 * «Предупреждать, когда день завершён: что не доели и это может сказаться на
 * состоянии ребёнка».
 *
 * Решает сервер (`yesterday_shortfall` сводки): что съедено по отметкам,
 * какая норма действовала вчера и вышел ли недобор за допуск ядра. Экран
 * только подставляет число. Нет поля — молчим: сервер отдаёт его лишь тогда,
 * когда вчера было что сравнивать, и тревога про день без записей была бы
 * ложной. Тот же текст — в Mini App.
 */
export function YesterdayShortfallNotice({
  shortfall,
}: {
  shortfall: PatientOverview["yesterday_shortfall"];
}) {
  const { t } = useTranslation("home");
  if (shortfall === null || shortfall === undefined) return null;

  return (
    <WarningBanner level="warning" title={t("yesterdayShortfall.title")}>
      {t("yesterdayShortfall.text", {
        value: formatKcal(shortfall.shortfall_kcal),
      })}
    </WarningBanner>
  );
}
