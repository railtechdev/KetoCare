/**
 * Ответы API для тестов вкладки «Дневник» — по пути запроса.
 *
 * Только для тестов: приложение этот модуль не импортирует. Один на два
 * файла тестов, потому что экран и лента ходят в одни и те же ручки, и
 * подделка, разошедшаяся между ними, проверяла бы два разных контракта.
 */

export const PATIENT_ID = "11111111-1111-4111-8111-111111111111";
export const ME = "22222222-2222-4222-8222-222222222222";
export const GRANDMA = "33333333-3333-4333-8333-333333333333";

export const SESSION = {
  patientId: PATIENT_ID,
  patientName: "Амина",
  webUrl: "https://ketocare.example",
  hasWebCredentials: true,
};

/** Момент «час назад» — внутри обоих периодов и не в будущем. */
export function hourAgo(): string {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString();
}

function base(id: string, createdBy: string | null) {
  return {
    id,
    patient_id: PATIENT_ID,
    occurred_at: hourAgo(),
    source: "bot",
    created_by: createdBy,
    created_at: hourAgo(),
  };
}

export type LogsByKind = Partial<Record<string, unknown[]>>;

export function defaultLogs(): LogsByKind {
  return {
    ketones: [{ ...base("k1", ME), value: 3.2, method: "blood" }],
    // weight:raw — ответ сервера в подделке, а не показ.
    weight: [{ ...base("w1", GRANDMA), weight_kg: 18.4, height_cm: null }],
    seizures: [
      {
        ...base("s1", ME),
        seizure_type_id: "t1",
        duration_sec: null,
        duration_option_id: "d1",
        count: 2,
        description: null,
        triggers: null,
      },
    ],
    medications: [],
    meals: [],
    "side-effects": [],
  };
}

/** Реализация `api.GET` для `mockImplementation`. */
export function fakeGet(logs: LogsByKind = defaultLogs()) {
  return (path: string) => {
    const logKind = /\/logs\/([a-z-]+)$/.exec(path)?.[1];
    if (logKind !== undefined) {
      const items = logs[logKind] ?? [];
      return Promise.resolve({ data: { items, total: items.length } });
    }
    if (path.endsWith("/prescriptions")) {
      return Promise.resolve({
        data: { items: [{ ratio: 4, effective_from: "2026-08-01" }], total: 1 },
      });
    }
    if (path.endsWith("/parents")) {
      return Promise.resolve({
        data: [
          {
            id: ME,
            full_name: "Мама Амины",
            is_me: true,
            can_remove: false,
            invited_by_name: null,
          },
          {
            id: GRANDMA,
            full_name: "Бабушка Галя",
            is_me: false,
            can_remove: true,
            invited_by_name: "Мама Амины",
          },
        ],
      });
    }
    if (path.endsWith("/seizure-types")) {
      return Promise.resolve({
        data: { items: [{ id: "t1", name_ru: "Тонико-клонический" }] },
      });
    }
    if (path.endsWith("/intake-options")) {
      return Promise.resolve({
        data: { items: [{ id: "d1", name_ru: "от 1 до 5 минут" }] },
      });
    }
    if (path.endsWith("/medications")) {
      return Promise.resolve({
        data: { items: [{ id: "m1", drug_name: "Депакин", dose: "150 мг" }] },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  };
}
