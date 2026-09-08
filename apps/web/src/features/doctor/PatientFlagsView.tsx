import {
  Button,
  FactList,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
  Skeleton,
} from "@ketocare/ui";
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  ClipboardList,
  TriangleAlert,
} from "lucide-react";
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
    if (pending) return <Skeleton aria-hidden="true" className="h-5 w-28" />;

    // Сводка не пришла — это отдельное состояние, а не «замечаний нет».
    // Прочерк с `aria-hidden` не говорил ничего вообще: скринридер читал
    // пустую ячейку, а зрячий врач принимал её за спокойную строку. Триаж,
    // выдающий «всё хорошо» там, где ничего не известно, — худшая из его
    // возможных ошибок (правило П19 канона).
    return (
      <span
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
        data-flag="unknown"
      >
        <CircleHelp aria-hidden="true" className="size-4" />
        {t("flags.unknown")}
      </span>
    );
  }

  const badges: {
    key: string;
    className: string;
    icon: typeof CircleAlert;
    label: string;
  }[] = [];

  if (flags.noPrescription) {
    // Первым: это не отклонение в наблюдении, а отсутствие самого наблюдения.
    badges.push({
      key: "no-prescription",
      className: "bg-destructive text-destructive-foreground",
      icon: ClipboardList,
      label: t("flags.noPrescription"),
    });
  }

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
    // Давность показывается и у спокойной строки: правило П19 требует в строке
    // «давность последних данных», а величина уже посчитана для каждого
    // пациента и раньше просто выбрасывалась. Без неё врач не отличает
    // ребёнка, чей замер пришёл час назад, от ребёнка с записью позавчера —
    // на пороге в трое суток это разные ситуации.
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <CircleCheck aria-hidden="true" className="size-4" />
        {t("flags.noneWithRecency", { recency: recencyLabel(t, flags) })}
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

/** Подпись давности последних данных: «данные сегодня» / «данные 2 дн. назад». */
function recencyLabel(
  t: ReturnType<typeof useTranslation<"doctor">>["t"],
  flags: PatientFlags,
): string {
  if (flags.daysSinceLastReading === null) return t("flags.lastDataNever");
  if (flags.daysSinceLastReading === 0) return t("flags.lastData");
  return t("flags.lastDataDays", { count: flags.daysSinceLastReading });
}

/**
 * Расшифровка флагов — по требованию, а не постоянным блоком.
 *
 * Порог вынесен в `NO_DATA_FLAG_DAYS` и подставляется сюда: врач должен видеть,
 * по какому именно порогу помечена строка, а не догадываться о нём.
 *
 * Почему в поповере. Раскрытой легенда стояла вплотную под списком, в том же
 * блоке: строка пациента — 42 px, легенда под ней — 192 px, зазор 16 px. Врач,
 * читая сверху вниз, видел имя пациента и под ним четыре строки с пометками,
 * которые выглядели как пометки ЭТОГО пациента — при том что у него одна.
 * Справка, которую читают один раз, занимала вчетверо больше места, чем то,
 * что она объясняет, и вводила в заблуждение каждый день.
 *
 * `Popover` берётся у кита: он стоял установленным и не использовался ни разу,
 * пока раскрывающиеся блоки писались вручную.
 */
export function PatientFlagsLegend() {
  const { t } = useTranslation("doctor");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="self-start">
          <CircleHelp aria-hidden="true" />
          {t("flags.legend.open")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[90vw]">
        <PopoverTitle>{t("flags.legend.title")}</PopoverTitle>
        <FactList className="mt-field text-muted-foreground">
          <dt className="flex items-center gap-1.5 font-semibold">
            <ClipboardList
              aria-hidden="true"
              className="size-4 text-destructive"
            />
            {t("flags.legend.noPrescriptionTerm")}
          </dt>
          <dd className="m-0">{t("flags.legend.noPrescription")}</dd>
          <dt className="flex items-center gap-1.5 font-semibold">
            <CircleAlert
              aria-hidden="true"
              className="size-4 text-destructive"
            />
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
          <dt className="flex items-center gap-1.5 font-semibold">
            <CircleHelp aria-hidden="true" className="size-4" />
            {t("flags.legend.unknownTerm")}
          </dt>
          <dd className="m-0">{t("flags.legend.unknown")}</dd>
        </FactList>
      </PopoverContent>
    </Popover>
  );
}
