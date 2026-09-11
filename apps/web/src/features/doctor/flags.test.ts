import { describe, expect, it } from "vitest";

import { attentionRank, computePatientFlags, NO_DATA_FLAG_DAYS } from "./flags";
import type { PatientOverview } from "./types";

/**
 * Назначение в наборе по умолчанию: молчание семьи и вердикт о допуске имеют
 * смысл только у ребёнка, которому уже назначена терапия. Случай «назначения
 * нет» проверяется отдельно и явно.
 */
const PRESCRIPTION = {
  id: "rx1",
  patient_id: "p1",
  ratio: 3.5,
  kcal_per_day: 1200,
  protein_g: 12,
  carbs_limit_g: 35,
  meals_per_day: 4,
  starts_on: "2026-08-01",
  created_at: "2026-08-01T10:00:00Z",
} as unknown as NonNullable<PatientOverview["prescription"]>;

function overview(patch: Partial<PatientOverview> = {}): PatientOverview {
  return {
    patient_id: "p1",
    date: "2026-08-28",
    prescription: PRESCRIPTION,
    day: null,
    last_ketone: null,
    last_weight: null,
    seizures_today: { entries: 0, count: 0 },
    seizure_trend: { recent: 0, previous: 0, grew: null, appeared: false },
    monitoring_phase: "routine",
    ...patch,
  };
}

const TOTALS = {
  kcal: 1200,
  fat: 100,
  protein: 30,
  carbs: 12,
  fiber: 4,
  ratio: 2.4,
};

describe("computePatientFlags", () => {
  it("без сводки флагов нет", () => {
    expect(computePatientFlags(null)).toBeNull();
  });

  it("не выдаёт неразобранную дату сводки за отсутствие замеров", () => {
    // Красное «Замеров ещё не было» — клиническое утверждение. Сказать его по
    // сбою разбора значит поднять наверх списка ребёнка, который меряется
    // дважды в день, и увести внимание врача от того, кто действительно молчит.
    const flags = computePatientFlags(
      overview({
        date: "не дата",
        last_ketone: {
          value: 3.1,
          method: "blood",
          occurred_at: "2026-08-28T08:00:00+05:00",
        },
      }),
    );

    expect(flags).toBeNull();
  });

  it("считает сутки по календарю, а не по разнице часов", () => {
    const flags = computePatientFlags(
      overview({
        last_ketone: {
          value: 3.1,
          method: "blood",
          occurred_at: "2026-08-27T22:30:00+05:00",
        },
      }),
    );

    expect(flags?.daysSinceLastReading).toBe(1);
    expect(flags?.staleData).toBe(false);
  });

  it("берёт самый свежий из замеров", () => {
    const flags = computePatientFlags(
      overview({
        last_ketone: {
          value: 3.1,
          method: "blood",
          occurred_at: "2026-08-10T09:00:00+05:00",
        },
        last_weight: {
          weight_kg: 18.4,
          occurred_at: "2026-08-26T09:00:00+05:00",
        },
      }),
    );

    expect(flags?.daysSinceLastReading).toBe(2);
  });

  it("записи о приступах за сегодня снимают молчание", () => {
    const flags = computePatientFlags(
      overview({
        last_ketone: {
          value: 3.1,
          method: "blood",
          occurred_at: "2026-07-01T09:00:00+05:00",
        },
        seizures_today: { entries: 1, count: 2 },
      }),
    );

    expect(flags?.daysSinceLastReading).toBe(0);
    expect(flags?.staleData).toBe(false);
  });

  it("помечает молчание ровно на пороге ТЗ", () => {
    const atThreshold = computePatientFlags(
      overview({
        last_weight: {
          weight_kg: 18.4,
          occurred_at: "2026-08-25T09:00:00+05:00",
        },
      }),
    );
    const beforeThreshold = computePatientFlags(
      overview({
        last_weight: {
          weight_kg: 18.4,
          occurred_at: "2026-08-26T09:00:00+05:00",
        },
      }),
    );

    expect(NO_DATA_FLAG_DAYS).toBe(3);
    expect(atThreshold?.daysSinceLastReading).toBe(3);
    expect(atThreshold?.staleData).toBe(true);
    expect(beforeThreshold?.staleData).toBe(false);
  });

  it("считает молчанием и полное отсутствие замеров", () => {
    const flags = computePatientFlags(overview());

    expect(flags?.daysSinceLastReading).toBeNull();
    expect(flags?.staleData).toBe(true);
  });

  it("помечает пациента без назначения — и не считает его молчащим", () => {
    // Ребёнок прикрепляется к врачу молча, в момент, когда семья его заводит.
    // Первое, что от врача требуется, — назначение; до него не с чем сверять
    // день. А «замеров нет трое суток» у такого пациента говорит не о семье, а
    // о том же самом: терапии ещё не назначено. Второй красный значок рядом
    // делит внимание и ничего не добавляет.
    const flags = computePatientFlags(overview({ prescription: null }));

    expect(flags?.noPrescription).toBe(true);
    expect(flags?.staleData).toBe(false);
  });

  it("ставит ожидание назначения выше молчания и отклонения вместе", () => {
    const waiting = computePatientFlags(overview({ prescription: null }));
    const worst = computePatientFlags(
      overview({
        day: {
          totals: TOTALS,
          tolerance: {
            ratio_within_tolerance: false,
            kcal_within_tolerance: false,
          },
          engine_version: "1.0.0",
        },
      }),
    );

    expect(worst?.staleData).toBe(true);
    expect(worst?.nutritionOff).toBe(true);
    expect(attentionRank(waiting)).toBeGreaterThan(attentionRank(worst));
  });

  it("отклонение питания берёт из вердикта сервера", () => {
    const off = computePatientFlags(
      overview({
        day: {
          totals: TOTALS,
          tolerance: {
            ratio_within_tolerance: false,
            kcal_within_tolerance: true,
          },
          engine_version: "1.0.0",
        },
      }),
    );
    const within = computePatientFlags(
      overview({
        day: {
          totals: TOTALS,
          tolerance: {
            ratio_within_tolerance: true,
            kcal_within_tolerance: true,
          },
          engine_version: "1.0.0",
        },
      }),
    );

    expect(off?.nutritionOff).toBe(true);
    expect(within?.nutritionOff).toBe(false);
  });

  it("не поднимает флаг из-за одной калорийности недоспланированного дня", () => {
    // Сервер сравнивает набранное за день с СУТОЧНОЙ нормой, поэтому у любого
    // пациента, у кого спланирован не весь день, kcal_within_tolerance ложен.
    // Учитывать его во флаге значит зажечь флаг у всего списка сразу — и
    // столбец «Внимание» перестанет что-либо выделять.
    const flags = computePatientFlags(
      overview({
        day: {
          totals: TOTALS,
          tolerance: {
            ratio_within_tolerance: true,
            kcal_within_tolerance: false,
          },
          engine_version: "1.0.0",
        },
      }),
    );

    expect(flags?.nutritionOff).toBe(false);
  });

  it("без вердикта сервера флага отклонения нет", () => {
    const flags = computePatientFlags(
      overview({ day: { totals: TOTALS, tolerance: null } }),
    );

    expect(flags?.nutritionOff).toBe(false);
  });
});

describe("attentionRank", () => {
  it("поднимает молчание выше отклонения питания", () => {
    expect(
      attentionRank({
        noPrescription: false,
        daysSinceLastReading: 5,
        strictMonitoring: false,
        staleData: true,
        nutritionOff: false,
        seizuresGrew: false,
        seizuresAppeared: false,
      }),
    ).toBeGreaterThan(
      attentionRank({
        noPrescription: false,
        daysSinceLastReading: 0,
        strictMonitoring: false,
        staleData: false,
        nutritionOff: true,
        seizuresGrew: false,
        seizuresAppeared: false,
      }),
    );
  });

  it("строка без сводки не поднимается наверх", () => {
    expect(attentionRank(null)).toBe(0);
  });
});

/**
 * Приступов стало больше — врач видит это в списке пациентов.
 *
 * Вердикт считает сервер: порог «более 50 %» — медицинское правило (ответ
 * клиники 09.09.2026, вопрос 12), и его копия здесь однажды разошлась бы с
 * расчётом. Задача этого модуля — только показать вердикт и взвесить его в
 * порядке внимания.
 */
describe("флаг роста приступов", () => {
  it("поднимается по вердикту сервера, а не по числам", () => {
    // Числа в сводке есть, но считать по ним «больше ли на 50 %» здесь нельзя:
    // это второй источник медицинского правила.
    const flags = computePatientFlags(
      overview({
        seizure_trend: { recent: 7, previous: 4, grew: true, appeared: false },
      }),
    );

    expect(flags?.seizuresGrew).toBe(true);
    expect(flags?.seizuresAppeared).toBe(false);
  });

  it("не поднимается, когда сервер сказал «нет»", () => {
    const flags = computePatientFlags(
      overview({
        seizure_trend: { recent: 6, previous: 4, grew: false, appeared: false },
      }),
    );

    expect(flags?.seizuresGrew).toBe(false);
  });

  it("возобновление — отдельный флаг, а не рост", () => {
    // Предыдущая неделя без приступов: процент не считается, сравнивать не с
    // чем. Свести это к «стало больше» значило бы выдумать величину.
    const flags = computePatientFlags(
      overview({
        seizure_trend: { recent: 3, previous: 0, grew: null, appeared: true },
      }),
    );

    expect(flags?.seizuresGrew).toBe(false);
    expect(flags?.seizuresAppeared).toBe(true);
  });

  it("две спокойные недели не поднимают ничего", () => {
    const flags = computePatientFlags(
      overview({
        seizure_trend: { recent: 0, previous: 0, grew: null, appeared: false },
      }),
    );

    expect(flags?.seizuresGrew).toBe(false);
    expect(flags?.seizuresAppeared).toBe(false);
  });

  it("стоит в порядке внимания выше молчания семьи", () => {
    // Ухудшение течения болезни важнее отсутствия записей: врач, открывший
    // список, должен увидеть такого ребёнка раньше.
    //
    // У «выросшего» стоит сегодняшний замер — иначе он молчащий ТОЖЕ, и
    // сравнивались бы 5 против 2, а не 3 против 2: проверка прошла бы при любом
    // весе роста, вплоть до единицы.
    const grew = computePatientFlags(
      overview({
        last_ketone: {
          value: 3.1,
          method: "blood",
          occurred_at: "2026-08-28T09:00:00Z",
        } as unknown as PatientOverview["last_ketone"],
        seizure_trend: { recent: 7, previous: 4, grew: true, appeared: false },
      }),
    );
    const silent = computePatientFlags(overview({ date: "2026-08-28" }));

    expect(grew?.staleData).toBe(false);
    expect(silent?.staleData).toBe(true);
    expect(attentionRank(grew)).toBeGreaterThan(attentionRank(silent));
  });
});

/**
 * Первый месяц терапии — строгое наблюдение (ответ клиники 09.09.2026, вопрос
 * 11): «даже один день молчания будет звонком».
 *
 * Режим решает сервер (ему нужна дата начала терапии), кабинет выбирает по нему
 * порог. «Один день молчания» — целые прошедшие сутки без записей: сегодня ещё
 * идёт и молчанием не считается.
 */
describe("строгое наблюдение в первый месяц терапии", () => {
  /** Последний замер веса за `daysAgo` суток до даты сводки 2026-08-28. */
  function weighedDaysAgo(daysAgo: number): Partial<PatientOverview> {
    const day = String(28 - daysAgo).padStart(2, "0");
    return {
      last_weight: {
        weight_kg: 18.4,
        occurred_at: `2026-08-${day}T09:00:00+05:00`,
      } as unknown as PatientOverview["last_weight"],
    };
  }

  it("помечает целые сутки без записей", () => {
    // Последняя запись позавчера: вчера семья не внесла ничего.
    const flags = computePatientFlags(
      overview({ ...weighedDaysAgo(2), monitoring_phase: "strict" }),
    );

    expect(flags?.strictMonitoring).toBe(true);
    expect(flags?.staleData).toBe(true);
  });

  it("не помечает семью, которая ещё не записала сегодня", () => {
    // Последняя запись вчера. С порогом «1» пометка стояла бы с утра у каждой
    // такой семьи — и перестала бы что-либо выделять.
    const flags = computePatientFlags(
      overview({ ...weighedDaysAgo(1), monitoring_phase: "strict" }),
    );

    expect(flags?.staleData).toBe(false);
  });

  it("после первого месяца порог прежний", () => {
    // Обратная сторона: строгий порог не должен протечь в обычный контроль —
    // иначе проверки выше прошли бы и на кабинете с порогом «2» для всех.
    const flags = computePatientFlags(
      overview({ ...weighedDaysAgo(2), monitoring_phase: "routine" }),
    );

    expect(flags?.strictMonitoring).toBe(false);
    expect(flags?.staleData).toBe(false);
  });

  it("до начала терапии строгого режима нет", () => {
    const flags = computePatientFlags(
      overview({ ...weighedDaysAgo(2), monitoring_phase: "before_start" }),
    );

    expect(flags?.staleData).toBe(false);
  });

  it("без поля от сервера — обычный контроль, а не тревога", () => {
    // Секунды между выкатом кабинета и перезапуском API: новая страница
    // разговаривает со старым ответом.
    const stale = overview(weighedDaysAgo(2)) as Partial<PatientOverview>;
    delete stale.monitoring_phase;

    const flags = computePatientFlags(stale as PatientOverview);

    expect(flags?.strictMonitoring).toBe(false);
    expect(flags?.staleData).toBe(false);
  });
});
