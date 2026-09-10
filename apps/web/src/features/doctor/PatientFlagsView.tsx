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
  Activity,
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
 * Пометка: значок, цвет и место в порядке — в ОДНОМ месте.
 *
 * Раньше строка списка и легенда рисовались двумя рукописными списками, и они
 * разошлись при первом же добавлении пометки: «Приступов стало больше» получило
 * в легенде оранжевый треугольник вместо красного пульса, две записи остались
 * вовсе без значка, а «Кетосоотношение вне допуска» свой значок потеряло. Врач
 * при этом ищет в легенде ровно то, что видит в строке.
 *
 * Порядок ключей здесь — порядок значков в строке, и он совпадает с весами
 * `attentionRank`: список сортируется по ним, и глаз обязан читать пометки в том
 * же порядке, в каком они двигают строку вверх.
 */
export const FLAG_KEYS = [
  "no-prescription",
  "seizures-grew",
  "seizures-appeared",
  "stale",
  "nutrition",
] as const;

export type FlagKey = (typeof FLAG_KEYS)[number];

/** Цвет пометки. Пара «фон + текст» проверяется на контраст в `packages/ui`. */
type FlagTone = "danger" | "warning";

const LOOK: Record<FlagKey, { icon: typeof CircleAlert; tone: FlagTone }> = {
  "no-prescription": { icon: ClipboardList, tone: "danger" },
  "seizures-grew": { icon: Activity, tone: "danger" },
  "seizures-appeared": { icon: Activity, tone: "danger" },
  stale: { icon: CircleAlert, tone: "danger" },
  nutrition: { icon: TriangleAlert, tone: "warning" },
};

const BADGE_TONE: Record<FlagTone, string> = {
  danger: "bg-destructive text-destructive-foreground",
  warning: "bg-warning text-on-warning",
};

/** В легенде значок стоит без плашки, поэтому цвет несёт он сам. */
const LEGEND_TONE: Record<FlagTone, string> = {
  danger: "text-destructive",
  warning: "text-warning",
};

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

  // Подпись зависит от данных, поэтому живёт здесь; значок, цвет и порядок —
  // в `LOOK` и `FLAG_KEYS`, общих с легендой.
  const labels: Record<FlagKey, string | null> = {
    // Первой: это не отклонение в наблюдении, а отсутствие самого наблюдения.
    "no-prescription": flags.noPrescription ? t("flags.noPrescription") : null,
    // Приступы — выше молчания семьи и питания: ухудшение течения болезни
    // важнее отсутствия записей и отклонения рациона за день. Тот же порядок
    // задан весами в `attentionRank`.
    "seizures-grew": flags.seizuresGrew ? t("flags.seizuresGrew") : null,
    "seizures-appeared": flags.seizuresAppeared
      ? t("flags.seizuresAppeared")
      : null,
    stale: !flags.staleData
      ? null
      : flags.daysSinceLastReading === null
        ? t("flags.noReadingsEver")
        : t("flags.noReadings", { days: flags.daysSinceLastReading }),
    nutrition: flags.nutritionOff ? t("flags.nutritionOff") : null,
  };

  const badges = FLAG_KEYS.filter((key) => labels[key] !== null).map((key) => ({
    key,
    label: labels[key] as string,
    icon: LOOK[key].icon,
    className: BADGE_TONE[LOOK[key].tone],
  }));

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

  /** Ключ пометки → ключи строк словаря. Порог подставляется в текст. */
  const TEXT: Record<FlagKey, { term: string; description: string }> = {
    "no-prescription": {
      term: t("flags.legend.noPrescriptionTerm"),
      description: t("flags.legend.noPrescription"),
    },
    "seizures-grew": {
      term: t("flags.legend.seizuresGrewTerm"),
      description: t("flags.legend.seizuresGrew"),
    },
    "seizures-appeared": {
      term: t("flags.legend.seizuresAppearedTerm"),
      description: t("flags.legend.seizuresAppeared"),
    },
    stale: {
      term: t("flags.legend.noReadingsTerm"),
      // Врач должен видеть порог, по которому помечена строка, а не
      // догадываться о нём: число живёт в `NO_DATA_FLAG_DAYS`.
      description: t("flags.legend.noReadings", { days: NO_DATA_FLAG_DAYS }),
    },
    nutrition: {
      term: t("flags.legend.nutritionOffTerm"),
      description: t("flags.legend.nutritionOff"),
    },
  };

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
          {FLAG_KEYS.map((key) => {
            const Icon = LOOK[key].icon;
            return (
              <div key={key} className="contents">
                <dt
                  className="flex items-center gap-1.5 font-semibold"
                  data-legend={key}
                >
                  <Icon
                    aria-hidden="true"
                    className={`size-4 ${LEGEND_TONE[LOOK[key].tone]}`}
                  />
                  {TEXT[key].term}
                </dt>
                <dd className="m-0">{TEXT[key].description}</dd>
              </div>
            );
          })}
          {/* «Сводка не получена» — не пометка строки, а её отсутствие:
              своего места в `FLAG_KEYS` у неё нет, а объяснить её надо. */}
          <dt
            className="flex items-center gap-1.5 font-semibold"
            data-legend="unknown"
          >
            <CircleHelp aria-hidden="true" className="size-4" />
            {t("flags.legend.unknownTerm")}
          </dt>
          <dd className="m-0">{t("flags.legend.unknown")}</dd>
        </FactList>
      </PopoverContent>
    </Popover>
  );
}
