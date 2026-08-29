import { parseDateInput } from "../diary/time";
import type { PatientOverview } from "./types";

/**
 * Порог флага «нет данных» в сутках.
 *
 * TODO(med): значение не подтверждено медицинской командой. Раздел 8.3 ТЗ задаёт
 * его как «default 3, # TODO(med)», то есть это заглушка до решения врачей, а не
 * обоснованный порог. Живёт одной именованной константой и подставляется в
 * подписи через i18n: число, размазанное по разметке и текстам, обновляют не
 * целиком, и часть экрана продолжила бы жить по старому порогу.
 */
export const NO_DATA_FLAG_DAYS = 3;

export interface PatientFlags {
  /**
   * Сутки с последнего замера, известного серверу; null — замеров ещё не было.
   *
   * Именно «не было», а не «не удалось посчитать»: неразобранная дата сводки
   * отсекается раньше и даёт `null` вместо всего набора флагов.
   */
  daysSinceLastReading: number | null;
  /**
   * Замеров нет дольше `NO_DATA_FLAG_DAYS` — или их не было вовсе.
   *
   * «Данные» здесь — то, о чём сводка сообщает с меткой времени: последний замер
   * кетонов, последний замер веса и записи о приступах за сегодня. Полный
   * признак «семья ничего не вносила N дней» по всем шести дневникам сводка не
   * отдаёт, а собирать его на клиенте — это шесть запросов на каждого пациента
   * списка (см. отчёт: требует серверной поддержки).
   */
  staleData: boolean;
  /**
   * Кетосоотношение дня не уложилось в допуски назначения.
   *
   * Вердикт приходит от сервера (`day.tolerance`): допуски — медицинские
   * константы ядра (правило 2 CLAUDE.md), их копия в TypeScript со временем
   * разошлась бы с расчётом, и список показывал бы «в норме» там, где ядро
   * считает иначе.
   *
   * Калорийность в флаг не входит. Сервер сравнивает набранное за день с
   * суточной нормой, поэтому у любого пациента с недоспланированным днём
   * `kcal_within_tolerance` ложен — флаг горел бы у всего списка сразу и
   * перестал бы что-либо выделять. Кетосоотношение таким свойством не обладает:
   * оно обязано держаться в каждом приёме. Как сравнивать неполный день с
   * суточной нормой — вопрос медицинской команды
   * (docs/medical/OPEN_QUESTIONS.md, вопрос 9).
   */
  nutritionOff: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Календарных суток между двумя моментами по местному календарю.
 *
 * Считается по датам, а не по разнице в миллисекундах: замер вчера вечером и
 * взгляд врача сегодня утром — это одни сутки, а не «0 дней», и в сутках
 * перевода часов не 24 часа.
 */
function calendarDaysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / MS_PER_DAY);
}

function parseMoment(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Флаги строки списка пациентов (раздел 8.3 ТЗ, «Врач / Пациенты»).
 *
 * null — судить не о чем: сводки ещё нет (запрос идёт или отказан) либо её дата
 * не разобралась. Пустая строка честнее, чем «данных нет» по неполученному
 * ответу.
 *
 * За «сегодня» берётся дата из самой сводки, а не часы врача: сервер собирает
 * её в часовом поясе установки, и в другом поясе браузер добавил бы сутки
 * разницы к каждому пациенту сразу.
 */
export function computePatientFlags(
  overview: PatientOverview | null,
): PatientFlags | null {
  if (overview === null) return null;

  const today = parseDateInput(overview.date);
  // Дата сводки не разобралась — судить не о чем. Раньше этот случай попадал в
  // ту же ветку, что «замеров не было вовсе», и врач видел красное «Замеров ещё
  // не было» у ребёнка, который меряется дважды в день: сбой разбора выдавался
  // за клинический факт.
  if (today === null) return null;

  const readings = [
    parseMoment(overview.last_ketone?.occurred_at),
    parseMoment(overview.last_weight?.occurred_at),
    // Приступы за сегодня приходят числом без метки времени, но по смыслу
    // относятся к дате сводки: запись есть — молчания нет.
    overview.seizures_today.entries > 0 ? today : null,
  ].filter((value): value is Date => value !== null);

  const daysSinceLastReading =
    readings.length === 0
      ? null
      : Math.max(
          0,
          Math.min(
            ...readings.map((reading) => calendarDaysBetween(reading, today)),
          ),
        );

  const tolerance = overview.day?.tolerance ?? null;

  return {
    daysSinceLastReading,
    staleData:
      daysSinceLastReading === null ||
      daysSinceLastReading >= NO_DATA_FLAG_DAYS,
    nutritionOff: tolerance !== null && !tolerance.ratio_within_tolerance,
  };
}

/**
 * Вес строки для порядка по умолчанию: требующие внимания — сверху.
 *
 * Это порядок показа, а не оценка тяжести: «нет данных» помечен в ТЗ красным, а
 * отклонение питания — оранжевым, отсюда и разный вес.
 */
export function attentionRank(flags: PatientFlags | null): number {
  if (flags === null) return 0;
  return (flags.staleData ? 2 : 0) + (flags.nutritionOff ? 1 : 0);
}
