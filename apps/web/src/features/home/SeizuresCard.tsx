import { useTranslation } from "react-i18next";

import { Panel } from "./Panel";
import type { SeizuresToday } from "./types";

/**
 * Приступы за сегодня.
 *
 * Число приступов и число записей показываются раздельно, как их и отдаёт
 * сервер: одна запись дневника может описывать серию, и подмена приступов
 * записями занижала бы клиническую картину.
 */
export function SeizuresCard({ seizures }: { seizures: SeizuresToday }) {
  const { t } = useTranslation("home");

  return (
    <Panel title={t("seizures.title")}>
      {/* Ноль выводится наравне с любым другим числом: «сегодня приступов не
          было» — такой же результат дня, как и их количество. */}
      <p className="m-0 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums">
          {seizures.count}
        </span>
        <span className="text-muted">
          {t("seizures.unit", { count: seizures.count })}
        </span>
      </p>
      <p className="m-0 mt-1 text-sm text-muted">
        {t("seizures.entries", { count: seizures.entries })}
      </p>
    </Panel>
  );
}
