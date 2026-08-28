import { useTranslation } from "react-i18next";

import { NO_DATA_FLAG_DAYS, type PatientFlags } from "./flags";

const BADGE =
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap";

/**
 * Флаги строки списка пациентов (раздел 8.3 ТЗ).
 *
 * Цвета берутся из токенов темы с парным цветом текста (`text-on-danger`,
 * `text-on-warning`): контраст этих пар проверяется в packages/ui, а «белым по
 * умолчанию» на предупреждении он падает до 2.9 при требуемых 4.5.
 */
export function PatientFlagsView({ flags }: { flags: PatientFlags | null }) {
  const { t } = useTranslation("doctor");

  if (flags === null) {
    return (
      <span className="text-sm text-muted" aria-hidden="true">
        —
      </span>
    );
  }

  const badges: { key: string; className: string; label: string }[] = [];

  if (flags.staleData) {
    badges.push({
      key: "stale",
      className: "bg-danger text-on-danger",
      label:
        flags.daysSinceLastReading === null
          ? t("flags.noReadingsEver")
          : t("flags.noReadings", { days: flags.daysSinceLastReading }),
    });
  }

  if (flags.nutritionOff) {
    badges.push({
      key: "nutrition",
      className: "bg-warning text-on-warning",
      label: t("flags.nutritionOff"),
    });
  }

  if (badges.length === 0) {
    return <span className="text-sm text-muted">{t("flags.none")}</span>;
  }

  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {badges.map((badge) => (
        <li key={badge.key}>
          <span className={`${BADGE} ${badge.className}`} data-flag={badge.key}>
            {badge.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Расшифровка флагов под таблицей.
 *
 * Порог вынесен в `NO_DATA_FLAG_DAYS` и подставляется сюда: врач должен видеть,
 * по какому именно порогу помечена строка, а не догадываться о нём.
 */
export function PatientFlagsLegend() {
  const { t } = useTranslation("doctor");

  return (
    <dl className="m-0 grid gap-1 text-sm text-muted sm:grid-cols-[auto_1fr] sm:gap-x-3">
      <dt className="font-semibold">{t("flags.legend.noReadingsTerm")}</dt>
      <dd className="m-0">
        {t("flags.legend.noReadings", { days: NO_DATA_FLAG_DAYS })}
      </dd>
      <dt className="font-semibold">{t("flags.legend.nutritionOffTerm")}</dt>
      <dd className="m-0">{t("flags.legend.nutritionOff")}</dd>
    </dl>
  );
}
