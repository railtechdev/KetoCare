import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import {
  createDiaryLog,
  deleteDiaryLog,
  fetchDiaryLogs,
  updateDiaryLog,
  type DiaryBody,
  type DiaryKind,
  type DiaryPage,
} from "./diaryApi";
import { parseEffectiveFrom, type DiaryRange } from "./time";

/** Версия назначения для маркера на графике (раздел 8.2 ТЗ). */
export interface PrescriptionVersion {
  version: number;
  effectiveFrom: Date;
}

export interface MedicationOption {
  id: string;
  drugName: string;
  dose: string;
}

export interface DictionaryOption {
  id: string;
  name: string;
  /** Короткий код типа приступа (A, C, F, FG, M, T, TC, O) для месячной сетки */
  code?: string | null;
}

/** Ключ запроса дневника: иерархия «пациент → дневники → вид → период» (раздел 8.4 ТЗ). */
export function diaryLogsKey(
  patientId: string | null,
  kind: DiaryKind,
  range: DiaryRange | null,
) {
  return ["patient", patientId, "logs", kind, range?.from, range?.to] as const;
}

export function useDiaryLogs(
  patientId: string | null,
  kind: DiaryKind,
  range: DiaryRange | null,
) {
  return useQuery({
    queryKey: diaryLogsKey(patientId, kind, range),
    enabled: patientId !== null && range !== null,
    queryFn: async (): Promise<DiaryPage> => {
      if (patientId === null || range === null) {
        throw new Error("patientId and range are required to list diary logs");
      }
      return fetchDiaryLogs(patientId, kind, range);
    },
  });
}

/**
 * Создание, изменение и мягкое удаление записей.
 *
 * Каждая мутация инвалидирует ключ вида целиком, а не текущий период: удалённая
 * запись обязана исчезнуть и из соседнего периода, который лежит в кэше.
 */
export function useDiaryMutations(patientId: string | null, kind: DiaryKind) {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["patient", patientId, "logs", kind],
    });

  const create = useMutation({
    mutationFn: async (input: DiaryBody) => {
      if (patientId === null) {
        throw new Error("patientId is required to create a diary log");
      }
      await createDiaryLog(patientId, input);
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async (input: { logId: string; body: DiaryBody }) => {
      if (patientId === null) {
        throw new Error("patientId is required to update a diary log");
      }
      await updateDiaryLog(patientId, input.logId, input.body);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (logId: string) => {
      if (patientId === null) {
        throw new Error("patientId is required to delete a diary log");
      }
      await deleteDiaryLog(patientId, kind, logId);
    },
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

/**
 * История назначений — источник маркеров смены назначения на графике.
 *
 * Номера версий сервер не отдаёт: `prescriptions` append-only, версия — это
 * порядковый номер строки по времени создания (раздел 4.2 ТЗ). История приходит
 * от новых к старым, поэтому у первого элемента номер равен общему числу версий.
 */
export function usePrescriptionVersions(
  patientId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["patient", patientId, "prescriptions"],
    enabled: enabled && patientId !== null,
    queryFn: async (): Promise<PrescriptionVersion[]> => {
      if (patientId === null) {
        throw new Error("patientId is required to list prescriptions");
      }
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/prescriptions",
        {
          params: {
            path: { patient_id: patientId },
            query: { limit: 200, offset: 0 },
          },
        },
      );
      if (error || !data) {
        throw error ?? new Error("Empty prescriptions response");
      }

      return data.items.flatMap((item, index) => {
        const effectiveFrom = parseEffectiveFrom(item.effective_from);
        return effectiveFrom === null
          ? []
          : [{ version: data.total - index, effectiveFrom }];
      });
    },
  });
}

/** Препараты, назначенные пациенту: без них отметка о приёме не с чем связать. */
export function usePatientMedications(
  patientId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["patient", patientId, "medications"],
    enabled: enabled && patientId !== null,
    queryFn: async (): Promise<MedicationOption[]> => {
      if (patientId === null) {
        throw new Error("patientId is required to list medications");
      }
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
        drugName: item.drug_name,
        dose: item.dose,
      }));
    },
  });
}

/**
 * Справочник типов приступов.
 *
 * Читается из `/dictionaries` — ручки, открытой всем аутентифицированным
 * ролям: без списка типов семья не может сохранить запись о приступе, а это
 * главный дневник приложения для эпилепсии. Правка справочника осталась за
 * админом (`/admin/dictionaries/...`, раздел 4.2 ТЗ).
 *
 * Запрос идёт один раз за сессию (бессрочный кэш) и только на вкладке
 * приступов: список меняется правкой администратора, а не ходом дня. Если он
 * пуст или недоступен, форма добавления честно сообщает, что тип выбрать негде,
 * вместо того чтобы отправить выдуманный идентификатор.
 */
/**
 * Шкала длительности приступа — та же, что в анкете регистрации.
 *
 * Нужна и списку, и форме: приступ, записанный семьёй в боте интервалом,
 * хранит ссылку на вариант справочника, а не секунды (ADR-0020). Без этого
 * запроса кабинет показывал бы такую запись вовсе без длительности — родитель
 * ответил, а врач ответа не увидел.
 */
export function useDurationOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["dictionaries", "intake-options", "seizure_duration"],
    enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<DictionaryOption[]> => {
      const { data, error } = await api.GET(
        "/api/v1/dictionaries/intake-options",
        {
          params: { query: { scale: "seizure_duration" } },
        },
      );
      if (error || !data) {
        throw error ?? new Error("Empty duration options response");
      }
      return data.items.map((item) => ({
        id: item.id,
        name: item.name_ru,
        code: item.code,
      }));
    },
  });
}

export function useSeizureTypes(enabled: boolean) {
  return useQuery({
    queryKey: ["dictionaries", "seizure-types"],
    enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<DictionaryOption[]> => {
      const { data, error } = await api.GET(
        "/api/v1/dictionaries/seizure-types",
        { params: { query: { limit: 200, offset: 0 } } },
      );
      if (error || !data) {
        throw error ?? new Error("Empty seizure types response");
      }
      return data.items.map((item) => ({
        id: item.id,
        name: item.name_ru,
        code: item.code,
      }));
    },
  });
}
