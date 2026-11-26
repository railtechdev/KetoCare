import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";
import {
  RECENT_SEIZURE_TYPES,
  type DiaryEntryBody,
  type DiaryEntryKind,
} from "@ketocare/ui";

import { api } from "../../lib/api";
import { haptic } from "../../lib/telegram";

type Schemas = components["schemas"];

/**
 * Глубина списка записей. Две недели — то, что семья ещё помнит и может
 * поправить; дальше записи читает врач, а не тот, кто их внёс.
 */
export const DIARY_DAYS = 14;

/** Шесть видов записей в том порядке, в каком их называет бот. */
export const DIARY_KINDS: readonly DiaryEntryKind[] = [
  "seizures",
  "ketones",
  "weight",
  "medications",
  "meals",
  "side-effects",
];

/** Запись дневника с меткой вида — метка разводит union при отрисовке. */
export type DiaryLog =
  | ({ kind: "seizures" } & Schemas["SeizureLogRead"])
  | ({ kind: "ketones" } & Schemas["KetoneLogRead"])
  | ({ kind: "weight" } & Schemas["WeightLogRead"])
  | ({ kind: "medications" } & Schemas["MedicationLogRead"])
  | ({ kind: "meals" } & Schemas["MealLogRead"])
  | ({ kind: "side-effects" } & Schemas["SideEffectLogRead"]);

export interface NamedOption {
  id: string;
  name: string;
  /** Выведен из справочника (типы приступов до ILAE 2025, ADR-0050). */
  retired?: boolean;
  /** Номер узла ILAE у типа приступа — по нему строится выбор (Д3). */
  ilaeRef?: string | null;
}

export interface MedicationOption extends NamedOption {
  dose: string;
  /** Срок по схеме врача, `YYYY-MM-DD`: новая запись предлагает только
   * лекарства, действующие на её дату (аудит 26.11.2026, 1.4). */
  startedAt: string;
  stoppedAt: string | null;
}

/**
 * Границы списка — моменты с поясом по местным суткам, как у графиков:
 * ручка дневника голую дату не принимает.
 */
export function diaryRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  from.setDate(from.getDate() - (DIARY_DAYS - 1));
  const to = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Верхняя граница страницы на сервере (`MAX_PAGE_SIZE`). */
const PAGE_LIMIT = 200;

export async function fetchKind(
  patientId: string,
  kind: DiaryEntryKind,
  range: { from: string; to: string },
): Promise<DiaryLog[]> {
  const params = {
    path: { patient_id: patientId },
    query: { from: range.from, to: range.to, limit: PAGE_LIMIT, offset: 0 },
  };
  // Отдельная ветка на вид, а не путь из строки: у каждого вида свой точный
  // тип ответа, и приведение типов убрало бы единственную проверку формы.
  switch (kind) {
    case "seizures": {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/logs/seizures",
        { params },
      );
      if (error || !data) throw error ?? new Error("Empty seizures response");
      return data.items.map((item) => ({ kind, ...item }));
    }
    case "ketones": {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/logs/ketones",
        { params },
      );
      if (error || !data) throw error ?? new Error("Empty ketones response");
      return data.items.map((item) => ({ kind, ...item }));
    }
    case "weight": {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/logs/weight",
        { params },
      );
      if (error || !data) throw error ?? new Error("Empty weight response");
      return data.items.map((item) => ({ kind, ...item }));
    }
    case "medications": {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/logs/medications",
        { params },
      );
      if (error || !data)
        throw error ?? new Error("Empty medications response");
      return data.items.map((item) => ({ kind, ...item }));
    }
    case "meals": {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/logs/meals",
        { params },
      );
      if (error || !data) throw error ?? new Error("Empty meals response");
      return data.items.map((item) => ({ kind, ...item }));
    }
    case "side-effects": {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/logs/side-effects",
        { params },
      );
      if (error || !data)
        throw error ?? new Error("Empty side effects response");
      return data.items.map((item) => ({ kind, ...item }));
    }
  }
}

/**
 * Записи всех шести видов за две недели, новые сверху.
 *
 * Ключ — тот же, что у дневника кабинета («пациент → logs → вид → период»):
 * правка записи сбрасывает вид целиком, в каком бы периоде он ни лежал.
 */
export function useDiaryEntries(patientId: string) {
  const range = diaryRange();
  const results = useQueries({
    queries: DIARY_KINDS.map((kind) => ({
      queryKey: ["patient", patientId, "logs", kind, range.from, range.to],
      queryFn: () => fetchKind(patientId, kind, range),
    })),
  });

  const failed = results.find((result) => result.isError);
  const ready = results.every((result) => result.data !== undefined);
  const entries = ready
    ? results
        .flatMap((result) => result.data ?? [])
        .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
    : undefined;

  return {
    entries,
    isPending: results.some((result) => result.isPending),
    // Пауза без сети — только пока показывать нечего (как у графиков).
    isWaiting: results.some(
      (result) => result.fetchStatus === "paused" && result.isPending,
    ),
    error: failed?.error ?? null,
    refetch: () => results.forEach((result) => void result.refetch()),
  };
}

/** Препараты из схемы врача: по ним называется отметка о приёме. */
export function useMedications(patientId: string) {
  return useQuery({
    queryKey: ["patient", patientId, "medications"],
    queryFn: async (): Promise<MedicationOption[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/medications",
        {
          params: {
            path: { patient_id: patientId },
            query: { limit: 200, offset: 0 },
          },
        },
      );
      if (error || !data)
        throw error ?? new Error("Empty medications response");
      return data.items.map((item) => ({
        id: item.id,
        name: item.drug_name,
        dose: item.dose,
        startedAt: item.started_at,
        stoppedAt: item.stopped_at ?? null,
      }));
    },
  });
}

/** Типы приступов — справочник, меняется правкой администратора. */
export function useSeizureTypes() {
  return useQuery({
    queryKey: ["dictionaries", "seizure-types"],
    staleTime: Infinity,
    queryFn: async (): Promise<NamedOption[]> => {
      const { data, error } = await api.GET(
        "/api/v1/dictionaries/seizure-types",
        // Вместе с выведенными: прежние записи подписаны ими (ADR-0050).
        {
          params: { query: { limit: 200, offset: 0, include_retired: true } },
        },
      );
      if (error || !data)
        throw error ?? new Error("Empty seizure types response");
      return data.items.map((item) => ({
        id: item.id,
        name: item.name_ru,
        retired: item.retired ?? false,
        ilaeRef: item.ilae_ref ?? null,
      }));
    },
  });
}

/**
 * Что выбор типа приступа знает о справочнике, кроме самого списка.
 *
 * Пустой список значит разное: ответ ещё в пути, запрос ждёт связи или
 * сервер отказал. Пока выбор получал только `data ?? []`, отказ выглядел
 * вечной «загрузкой», и записать приступ было нельзя, ничего не объяснив.
 */
export interface DictionaryStatus {
  /** Ответа ещё нет (`isPending`). */
  pending: boolean;
  /** Ответа нет и запрос ждёт связи. */
  paused: boolean;
  /** Отказ последней загрузки; `null` — отказа нет. */
  error: unknown;
  retry: () => void;
}

/** Справочник уже на месте — состояние по умолчанию у формы правки. */
export const DICTIONARY_READY: DictionaryStatus = {
  pending: false,
  paused: false,
  error: null,
  retry: () => undefined,
};

export function dictionaryStatusOf(
  query: UseQueryResult<unknown>,
): DictionaryStatus {
  return {
    pending: query.isPending,
    paused: query.isPending && query.fetchStatus === "paused",
    error: query.isError ? query.error : null,
    retry: () => void query.refetch(),
  };
}

/**
 * Прошлые типы приступов для выбора: `null` — ответ ещё идёт.
 *
 * Отличать «ещё идёт» от «прошлых нет» обязательно: первый экран выбора
 * строится по этому ответу, и пришедший позже ответ перерисовал бы группы
 * классификации в прошлые типы под пальцем родителя — нажатие записало бы
 * не тот тип (аудит Mini App, Д3). Отказ и ожидание связи — пустой список:
 * выбор начнётся с групп, записать приступ они не мешают.
 */
export function recentSeizureTypesOf(
  query: UseQueryResult<string[]>,
): readonly string[] | null {
  if (query.data !== undefined) return query.data;
  if (query.isPending && query.fetchStatus === "fetching") return null;
  return [];
}

/**
 * Типы прошлых приступов ребёнка, свежие первыми — первый экран выбора типа,
 * как в боте (ADR-0076, аудит Mini App Д3).
 *
 * Ключ под «logs»: новая запись приступа сбрасывает и его, и следующий
 * приступ предложит только что выбранный тип. Отказ — не повод не дать
 * записать приступ: выбор просто начнётся с групп.
 */
export function useRecentSeizureTypes(patientId: string) {
  return useQuery({
    queryKey: ["patient", patientId, "logs", "seizure-recent-types"],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/logs/seizures/recent-types",
        {
          params: {
            path: { patient_id: patientId },
            query: { limit: RECENT_SEIZURE_TYPES },
          },
        },
      );
      if (error || !data)
        throw error ?? new Error("Empty recent seizure types response");
      return data.items;
    },
  });
}

/**
 * Шкала длительности приступа — та же, что у бота и анкеты (ADR-0020).
 * Приступ из бота хранит ссылку на вариант, а не секунды.
 */
export function useDurationOptions() {
  return useQuery({
    queryKey: ["dictionaries", "intake-options", "seizure_duration"],
    staleTime: Infinity,
    queryFn: async (): Promise<NamedOption[]> => {
      const { data, error } = await api.GET(
        "/api/v1/dictionaries/intake-options",
        { params: { query: { scale: "seizure_duration" } } },
      );
      if (error || !data)
        throw error ?? new Error("Empty duration options response");
      return data.items.map((item) => ({ id: item.id, name: item.name_ru }));
    },
  });
}

async function patchEntry(
  patientId: string,
  logId: string,
  input: DiaryEntryBody,
): Promise<void> {
  const params = { path: { patient_id: patientId, log_id: logId } };
  let error: unknown;
  switch (input.kind) {
    case "seizures":
      ({ error } = await api.PATCH(
        "/api/v1/patients/{patient_id}/logs/seizures/{log_id}",
        { params, body: input.body },
      ));
      break;
    case "ketones":
      ({ error } = await api.PATCH(
        "/api/v1/patients/{patient_id}/logs/ketones/{log_id}",
        { params, body: input.body },
      ));
      break;
    case "weight":
      ({ error } = await api.PATCH(
        "/api/v1/patients/{patient_id}/logs/weight/{log_id}",
        { params, body: input.body },
      ));
      break;
    case "medications":
      ({ error } = await api.PATCH(
        "/api/v1/patients/{patient_id}/logs/medications/{log_id}",
        { params, body: input.body },
      ));
      break;
    case "meals":
      ({ error } = await api.PATCH(
        "/api/v1/patients/{patient_id}/logs/meals/{log_id}",
        { params, body: input.body },
      ));
      break;
    case "side-effects":
      ({ error } = await api.PATCH(
        "/api/v1/patients/{patient_id}/logs/side-effects/{log_id}",
        { params, body: input.body },
      ));
      break;
  }
  if (error) throw error;
}

/**
 * Виды, которые Mini App записывает сам.
 *
 * Еды здесь нет: свободным текстом её Mini App не записывает — выдуманное
 * блюдо вошло бы в итоги дня наравне с настоящим, — а съеденное отмечают в
 * плане дня (дополнение к ADR-0044 от 07.10.2026).
 */
export type CreatableKind = Exclude<DiaryEntryKind, "meals">;
export type CreatableEntryBody = Exclude<DiaryEntryBody, { kind: "meals" }>;

/** Что сервер вернул на новую запись: вид и идентификатор (если пришёл). */
export interface CreatedEntry {
  kind: CreatableKind;
  id: string | null;
}

/**
 * Новая запись с ключом попытки (`Idempotency-Key`, ADR-0035).
 *
 * Ответ мог потеряться по дороге — запись уже лежит на сервере, а человек
 * видит отказ и нажимает «Сохранить» ещё раз. С тем же ключом и тем же телом
 * сервер отдаёт прежний ответ, а не заводит второй приступ: два приступа
 * вместо одного — это неверная частота, по которой врач судит о терапии.
 */
async function createEntry(
  patientId: string,
  input: CreatableEntryBody,
  idempotencyKey: string,
): Promise<CreatedEntry> {
  const params = {
    path: { patient_id: patientId },
    header: { "Idempotency-Key": idempotencyKey },
  };
  // Идентификатор новой записи — для «Отменить» под отметкой лекарства.
  let data: { id: string } | undefined;
  let error: unknown;
  switch (input.kind) {
    case "seizures":
      ({ data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/logs/seizures",
        { params, body: input.body },
      ));
      break;
    case "ketones":
      ({ data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/logs/ketones",
        { params, body: input.body },
      ));
      break;
    case "weight":
      ({ data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/logs/weight",
        {
          params,
          body: input.body,
        },
      ));
      break;
    case "medications":
      ({ data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/logs/medications",
        { params, body: input.body },
      ));
      break;
    case "side-effects":
      ({ data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/logs/side-effects",
        { params, body: input.body },
      ));
      break;
  }
  if (error) throw error;
  return { kind: input.kind, id: data?.id ?? null };
}

/** Мягкое удаление: запись остаётся в базе с `deleted_at` (правило 4). */
async function deleteEntry(
  patientId: string,
  kind: DiaryEntryKind,
  logId: string,
): Promise<void> {
  const params = { path: { patient_id: patientId, log_id: logId } };
  let error: unknown;
  switch (kind) {
    case "seizures":
      ({ error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/logs/seizures/{log_id}",
        { params },
      ));
      break;
    case "ketones":
      ({ error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/logs/ketones/{log_id}",
        { params },
      ));
      break;
    case "weight":
      ({ error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/logs/weight/{log_id}",
        { params },
      ));
      break;
    case "medications":
      ({ error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/logs/medications/{log_id}",
        { params },
      ));
      break;
    case "meals":
      ({ error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/logs/meals/{log_id}",
        { params },
      ));
      break;
    case "side-effects":
      ({ error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/logs/side-effects/{log_id}",
        { params },
      ));
      break;
  }
  if (error) throw error;
}

/**
 * Новая запись, правка и удаление.
 *
 * Сбрасываются и записи, и графики, и сводка: исправленный замер обязан
 * исчезнуть из всех трёх мест сразу, иначе на главной стоял бы «последний
 * замер», которого в дневнике уже нет.
 */
export function useEntryMutations(patientId: string) {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    // Сохранение и удаление ощущаются рукой (Bot API 6.1) — запись делают на
    // ходу, часто не глядя в экран.
    haptic("success");
    await Promise.all(
      (["logs", "trend", "overview"] as const).map((part) =>
        queryClient.invalidateQueries({
          queryKey: ["patient", patientId, part],
        }),
      ),
    );
  };

  const create = useMutation({
    mutationFn: (input: { body: CreatableEntryBody; idempotencyKey: string }) =>
      createEntry(patientId, input.body, input.idempotencyKey),
    onSuccess: invalidate,
    onError: () => haptic("error"),
  });

  const update = useMutation({
    mutationFn: (input: { logId: string; body: DiaryEntryBody }) =>
      patchEntry(patientId, input.logId, input.body),
    onSuccess: invalidate,
    onError: () => haptic("error"),
  });

  const remove = useMutation({
    mutationFn: (entry: { kind: DiaryEntryKind; id: string }) =>
      deleteEntry(patientId, entry.kind, entry.id),
    onSuccess: invalidate,
    onError: () => haptic("error"),
  });

  return { create, update, remove };
}
