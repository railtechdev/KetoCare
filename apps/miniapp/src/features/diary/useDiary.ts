import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";
import type { DiaryEntryBody, DiaryEntryKind } from "@ketocare/ui";

import { api } from "../../lib/api";

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
}

export interface MedicationOption extends NamedOption {
  dose: string;
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

async function fetchKind(
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
        { params: { query: { limit: 200, offset: 0 } } },
      );
      if (error || !data)
        throw error ?? new Error("Empty seizure types response");
      return data.items.map((item) => ({ id: item.id, name: item.name_ru }));
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
 * Правка и удаление записи.
 *
 * Сбрасываются и записи, и графики, и сводка: исправленный замер обязан
 * исчезнуть из всех трёх мест сразу, иначе на главной стоял бы «последний
 * замер», которого в дневнике уже нет.
 */
export function useEntryMutations(patientId: string) {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await Promise.all(
      (["logs", "trend", "overview"] as const).map((part) =>
        queryClient.invalidateQueries({
          queryKey: ["patient", patientId, part],
        }),
      ),
    );
  };

  const update = useMutation({
    mutationFn: (input: { logId: string; body: DiaryEntryBody }) =>
      patchEntry(patientId, input.logId, input.body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (entry: { kind: DiaryEntryKind; id: string }) =>
      deleteEntry(patientId, entry.kind, entry.id),
    onSuccess: invalidate,
  });

  return { update, remove };
}
