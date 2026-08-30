import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { patientOverviewKey } from "../patients/overview";
import {
  careTeamKey,
  clinicalNotesKey,
  medicalProfileKey,
  medicationsBranchKey,
  prescriptionsKey,
} from "./doctorQueries";
import type {
  ClinicalNote,
  MedicalProfile,
  MedicalProfileBody,
  Medication,
  MedicationBody,
  Prescription,
  PrescriptionBody,
} from "./types";

/**
 * Новая версия назначения (раздел 5.4 ТЗ).
 *
 * Инвалидируется и сводка: активное назначение — это последняя версия, и от неё
 * зависит вердикт о допусках в итогах дня. Оставить сводку в кэше значило бы
 * показывать соответствие старому назначению.
 */
export function useCreatePrescription(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: PrescriptionBody): Promise<Prescription> => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/prescriptions",
        { params: { path: { patient_id: patientId } }, body },
      );
      if (error || !data) {
        throw error ?? new Error("Empty prescription response");
      }
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: prescriptionsKey(patientId),
        }),
        queryClient.invalidateQueries({
          queryKey: patientOverviewKey(patientId),
        }),
      ]);
    },
  });
}

export function useSaveMedicalProfile(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: MedicalProfileBody): Promise<MedicalProfile> => {
      const { data, error } = await api.PUT(
        "/api/v1/patients/{patient_id}/medical-profile",
        { params: { path: { patient_id: patientId } }, body },
      );
      if (error || !data) {
        throw error ?? new Error("Empty medical profile response");
      }
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: medicalProfileKey(patientId),
      });
    },
  });
}

export function useMedicationMutations(patientId: string) {
  const queryClient = useQueryClient();

  // Инвалидируется вся ветка препаратов: под ней и полная схема терапии, и
  // укороченный список для дневника — после правки дозы устареть должны обе.
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: medicationsBranchKey(patientId),
    });

  const create = useMutation({
    mutationFn: async (body: MedicationBody): Promise<Medication> => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/medications",
        { params: { path: { patient_id: patientId } }, body },
      );
      if (error || !data) throw error ?? new Error("Empty medication response");
      return data;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async (input: {
      medicationId: string;
      body: MedicationBody;
    }): Promise<Medication> => {
      const { data, error } = await api.PUT(
        "/api/v1/patients/{patient_id}/medications/{medication_id}",
        {
          params: {
            path: { patient_id: patientId, medication_id: input.medicationId },
          },
          body: input.body,
        },
      );
      if (error || !data) throw error ?? new Error("Empty medication response");
      return data;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (medicationId: string): Promise<void> => {
      // Ответ 204 без тела: проверяется только ошибка, иначе успешное удаление
      // выглядело бы как пустой ответ и падало.
      const { error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/medications/{medication_id}",
        {
          params: {
            path: { patient_id: patientId, medication_id: medicationId },
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

/** Заметки только добавляются: ручек изменения и удаления сервер не даёт. */
export function useCreateClinicalNote(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (text: string): Promise<ClinicalNote> => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/clinical-notes",
        { params: { path: { patient_id: patientId } }, body: { text } },
      );
      if (error || !data) throw error ?? new Error("Empty note response");
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: clinicalNotesKey(patientId),
      });
    },
  });
}

/**
 * Кто ведёт пациента: подключить коллегу и снять ведение.
 *
 * Обязанность решена ADR-0003 и реализована на сервере целиком — с проверкой
 * доступа, запретом снимать последнего специалиста и записью в `audit_log`, —
 * но не вызывалась фронтендом ни разу. Пациент оставался навсегда закреплён за
 * тем, кто выдал приглашение семье: ни передать его в отпуск или при
 * увольнении, ни подключить диетолога было нельзя ни одной ролью, включая
 * администратора (к клиническим данным у него доступа нет).
 */
export function useCareTeamMutations(patientId: string) {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: careTeamKey(patientId) });

  const add = useMutation({
    mutationFn: async (doctorId: string): Promise<void> => {
      const { error } = await api.POST(
        "/api/v1/patients/{patient_id}/doctors",
        {
          params: { path: { patient_id: patientId } },
          body: { doctor_id: doctorId },
        },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (doctorId: string): Promise<void> => {
      const { error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/doctors/{doctor_id}",
        {
          params: { path: { patient_id: patientId, doctor_id: doctorId } },
        },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { add, remove };
}
