import { Skeleton } from "@ketocare/ui";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { NO_DATA_FLAG_DAYS, type PatientFlags } from "./flags";

const BADGE =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap";

/**
 * Флаги строки списка пациентов (раздел 8.3 ТЗ).
 *
 * Цвета берутся из токенов темы с парным цветом текста (`text-destructive-foreground`,
 * `text-on-warning`): контраст этих пар проверяется в packages/ui, а «белым по
 * умолчанию» на предупреждении он падает до 2.9 при требуемых 4.5.
 *
 * Каждый флаг несёт значок и текст: цвет — не единственный носитель смысла
 * (правило П19 канона, WCAG 1.4.1). При чёрно-белой печати выписки и при
 * дальтонизме различаются именно значок и подпись.
 */
export function PatientFlagsView({
  flags,
  pending = false,
}: {
  flags: PatientFlags | null;
  /** Сводка ещё грузится — вместо прочерка показывается скелетон */
  pending?: boolean;
}) {
  const { t } = useTranslation("doctor");

  if (flags === null) {
    // Скелетон в ячейке молчит: живая область на каждую строку списка
    // проговорила бы «собираем сводки» столько раз, сколько в нём пациентов.
    // Об этом сообщает одна живая область на весь список.
    return pending ? (
      <Skeleton aria-hidden="true" className="h-5 w-28" />
    ) : (
      <span className="text-sm text-muted-foreground" aria-hidden="true">
        —
      </span>
    );
  }

  const badges: {
    key: string;
    className: string;
    icon: typeof CircleAlert;
    label: string;
  }[] = [];

  if (flags.staleData) {
    badges.push({
      key: "stale",
      className: "bg-destructive text-destructive-foreground",
      icon: CircleAlert,
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
      icon: TriangleAlert,
      label: t("flags.nutritionOff"),
    });
  }

  if (badges.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <CircleCheck aria-hidden="true" className="size-4" />
        {t("flags.none")}
      </span>
    );
  }

  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {badges.map((badge) => (
        <li key={badge.key}>
          <span className={`${BADGE} ${badge.className}`} data-flag={badge.key}>
            <badge.icon aria-hidden="true" className="size-3.5" />
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
    <dl className="m-0 grid gap-1 text-sm text-muted-foreground sm:grid-cols-[auto_1fr] sm:gap-x-3">
      <dt className="flex items-center gap-1.5 font-semibold">
        <CircleAlert aria-hidden="true" className="size-4 text-destructive" />
        {t("flags.legend.noReadingsTerm")}
      </dt>
      <dd className="m-0">
        {t("flags.legend.noReadings", { days: NO_DATA_FLAG_DAYS })}
      </dd>
      <dt className="flex items-center gap-1.5 font-semibold">
        <TriangleAlert aria-hidden="true" className="size-4 text-warning" />
        {t("flags.legend.nutritionOffTerm")}
      </dt>
      <dd className="m-0">{t("flags.legend.nutritionOff")}</dd>
    </dl>
  );
}
