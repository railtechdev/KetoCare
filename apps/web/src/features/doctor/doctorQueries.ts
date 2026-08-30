import { useQueries, useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { patientOverviewQuery } from "../patients/overview";
import { withVersions } from "./prescriptionSchema";
import {
  DOCTOR_PAGE_LIMIT,
  type ClinicalNote,
  type Colleague,
  type FamilyMember,
  type Medication,
  type MedicalProfile,
  type PatientOverview,
  type Prescription,
  type PrescriptionVersion,
} from "./types";

/**
 * Запросы кабинета врача. Ключи — иерархией `['patient', id, ...]` (раздел 8.4
 * ТЗ), поэтому мутация инвалидирует ветку пациента целиком.
 */

/**
 * Сводки всех пациентов списка.
 *
 * Флаги строки (раздел 8.3 ТЗ) собираются из итогов дня и последних замеров, а
 * `GET /patients` отдаёт только профиль — сводку приходится запрашивать на
 * каждого пациента отдельно. Запросы идут параллельно и делят кэш с карточкой
 * пациента, но при большом списке это заметная нагрузка: агрегат на стороне
 * сервера убрал бы её (см. отчёт).
 */
export function usePatientOverviews(patientIds: readonly string[]) {
  return useQueries({
    queries: patientIds.map((patientId) => patientOverviewQuery(patientId)),
    combine: (results) => ({
      byPatientId: new Map<string, PatientOverview>(
        results.flatMap((result, index) => {
          const patientId = patientIds[index];
          return result.data === undefined || patientId === undefined
            ? []
            : [[patientId, result.data] as const];
        }),
      ),
      pending: results.some((result) => result.isPending),
      failed: results.some((result) => result.isError),
      // Повтор запроса сводок. Без него единственным выходом из «часть сводок
      // получить не удалось» была перезагрузка страницы: правило П15 требует
      // у ошибки кнопку «Повторить», а повторять было нечем.
      refetch: () => {
        for (const result of results) void result.refetch();
      },
    }),
  });
}

export interface PrescriptionHistory {
  versions: PrescriptionVersion[];
  total: number;
}

export function prescriptionsKey(patientId: string) {
  return ["patient", patientId, "prescriptions"] as const;
}

/**
 * Ключ истории назначений — с отдельным хвостом.
 *
 * `usePrescriptionVersions` (features/diary) ходит по тому же адресу API и
 * отдаёт МАССИВ версий, а этот хук — объект `{ versions, total }`. Пока ключ был
 * общим, обе формы попадали в одну ячейку кэша: на карте пациента вкладка
 * «Назначение» клала туда объект, а вкладка «Дневники» читала его как массив и
 * падала с `.filter is not a function`. Типы этого не ловят — каждый хук
 * объявляет свой возвращаемый тип, а ключ для кэша просто массив строк.
 *
 * Хвост не ломает инвалидацию: TanStack Query сверяет ключи по префиксу,
 * поэтому `invalidateQueries(prescriptionsKey(id))` по-прежнему накрывает обе
 * записи.
 */
export function prescriptionHistoryKey(patientId: string) {
  return [...prescriptionsKey(patientId), "history"] as const;
}

/** История назначений с номерами версий (раздел 8.3 ТЗ: таблица истории). */
export function usePrescriptionHistory(patientId: string) {
  return useQuery({
    queryKey: prescriptionHistoryKey(patientId),
    queryFn: async (): Promise<PrescriptionHistory> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/prescriptions",
        {
          params: {
            path: { patient_id: patientId },
            query: { limit: DOCTOR_PAGE_LIMIT, offset: 0 },
          },
        },
      );
      if (error || !data) {
        throw error ?? new Error("Empty prescriptions response");
      }

      return {
        total: data.total,
        versions: withVersions(data.items, data.total),
      };
    },
  });
}

export function medicalProfileKey(patientId: string) {
  return ["patient", patientId, "medical-profile"] as const;
}

/**
 * Медицинский профиль. `retry: false` — незаполненный профиль сервер отдаёт как
 * 404 («Медицинский профиль ещё не заполнен»), и повтор запроса его не создаст;
 * то же с 403 у диетолога.
 */
export function useMedicalProfile(patientId: string, enabled: boolean) {
  return useQuery({
    queryKey: medicalProfileKey(patientId),
    enabled,
    retry: false,
    queryFn: async (): Promise<MedicalProfile> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/medical-profile",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data) {
        throw error ?? new Error("Empty medical profile response");
      }
      return data;
    },
  });
}

/** Ветка препаратов пациента: под ней лежат обе выборки — полная и для дневника. */
export function medicationsBranchKey(patientId: string) {
  return ["patient", patientId, "medications"] as const;
}

/**
 * Полная схема терапии. Хвост `schedule` обязателен: под ключом ветки уже лежит
 * укороченный список препаратов для дневника (`features/diary/useDiary`), и
 * одинаковые ключи для разных форм ответа означали бы, что один экран читает из
 * кэша структуру, собранную для другого.
 */
export function medicationsKey(patientId: string) {
  return [...medicationsBranchKey(patientId), "schedule"] as const;
}

export function useMedications(patientId: string, enabled = true) {
  return useQuery({
    queryKey: medicationsKey(patientId),
    enabled,
    queryFn: async (): Promise<Medication[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/medications",
        {
          params: {
            path: { patient_id: patientId },
            query: { limit: DOCTOR_PAGE_LIMIT, offset: 0 },
          },
        },
      );
      if (error || !data) {
        throw error ?? new Error("Empty medications response");
      }
      return data.items;
    },
  });
}

export function clinicalNotesKey(patientId: string) {
  return ["patient", patientId, "clinical-notes"] as const;
}

export function useClinicalNotes(patientId: string, enabled: boolean) {
  return useQuery({
    queryKey: clinicalNotesKey(patientId),
    enabled,
    retry: false,
    queryFn: async (): Promise<ClinicalNote[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/clinical-notes",
        {
          params: {
            path: { patient_id: patientId },
            query: { limit: DOCTOR_PAGE_LIMIT, offset: 0 },
          },
        },
      );
      if (error || !data) {
        throw error ?? new Error("Empty clinical notes response");
      }
      return data.items;
    },
  });
}

/** Активное назначение из истории — последняя версия (раздел 4.2 ТЗ). */
export function activePrescriptionOf(
  history: PrescriptionHistory | undefined,
): Prescription | null {
  return history?.versions[0]?.prescription ?? null;
}

export function careTeamKey(patientId: string) {
  return ["patient", patientId, "doctors"] as const;
}

/**
 * Кто ведёт пациента.
 *
 * Ручка открыта и семье — родитель вправе знать, у кого есть доступ к данным
 * ребёнка, — но экрана у неё пока нет; здесь список нужен врачу, чтобы
 * передать пациента коллеге или подключить диетолога (ADR-0003, решение 3).
 */
export function useCareTeam(patientId: string) {
  return useQuery({
    queryKey: careTeamKey(patientId),
    queryFn: async (): Promise<Colleague[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/doctors",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data) throw error ?? new Error("Empty care team response");
      return data;
    },
  });
}

/**
 * Справочник персонала для выбора коллеги. Сервер отдаёт его только doctor и
 * dietitian; администратору он не нужен — к клиническим данным у него доступа
 * нет (правило 5 CLAUDE.md).
 */
export function useColleagues(enabled: boolean) {
  return useQuery({
    queryKey: ["users", "colleagues"],
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<Colleague[]> => {
      const { data, error } = await api.GET("/api/v1/users/colleagues", {});
      if (error || !data) throw error ?? new Error("Empty colleagues response");
      return data;
    },
  });
}

export function familyKey(patientId: string) {
  return ["patient", patientId, "parents"] as const;
}

/**
 * Кто ведёт ребёнка дома (ADR-0011).
 *
 * Флаг «семья молчит N дней» существует, чтобы вызвать действие, а единственное
 * осмысленное действие — связаться с семьёй — интерфейсом не поддерживалось:
 * контактов родителя в продукте не было нигде.
 */
export function useFamily(patientId: string) {
  return useQuery({
    queryKey: familyKey(patientId),
    queryFn: async (): Promise<FamilyMember[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/parents",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data) throw error ?? new Error("Empty family response");
      return data;
    },
  });
}
